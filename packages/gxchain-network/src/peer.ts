import { EventEmitter } from 'events';

import { AsyncQueue, Aborter } from '@gxchain2/utils';
import { Block, BlockHeader } from '@gxchain2/block';
import { Transaction } from '@gxchain2/tx';
import { constants } from '@gxchain2/common';

import pipe from 'it-pipe';
import type PeerId from 'peer-id';

import { Protocol, MessageInfo } from './protocol/protocol';
import { Libp2pNode } from './p2p';

export class PeerRequestTimeoutError extends Error {}

declare interface MsgQueue {
  on(event: 'status', listener: (message: any) => void): this;
  on(event: 'error', listener: (error: any) => void): this;

  once(event: 'status', listener: (message: any) => void): this;
  once(event: 'error', listener: (error: any) => void): this;
}

class MsgQueue extends EventEmitter {
  private readonly peer: Peer;
  private readonly aborter = new Aborter();
  private readonly queue: AsyncQueue;
  readonly protocol: Protocol;

  private readonly waitingRequests = new Map<
    number,
    {
      resolve: (data: any) => void;
      reject: (reason?: any) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(peer: Peer, protocol: Protocol) {
    super();
    this.peer = peer;
    this.protocol = protocol;
    this.queue = new AsyncQueue({
      push: (data: any) => {
        this.queue.array.push(data);
        if (this.queue.array.length > 10) {
          console.warn('MsgQueue drop message:', this.queue.array.shift());
        }
      }
    });
  }

  get name() {
    return this.protocol.name;
  }

  private makeMessageInfo(): MessageInfo {
    return {
      node: this.peer.node.node,
      peer: this.peer
    };
  }

  send(method: string, data: any) {
    if (this.aborter.isAborted) {
      throw new Error('MsgQueue already aborted');
    }
    const handler = this.protocol.findHandler(method);
    return this.queue.push(handler.encode(this.makeMessageInfo(), data));
  }

  request(method: string, data: any) {
    if (this.aborter.isAborted) {
      throw new Error('MsgQueue already aborted');
    }
    const handler = this.protocol.findHandler(method);
    if (!handler.response) {
      throw new Error(`MsgQueue invalid request: ${method}`);
    }
    if (this.waitingRequests.has(handler.response!)) {
      throw new Error(`MsgQueue repeated request: ${method}`);
    }
    return new Promise<any>((resolve, reject) => {
      this.waitingRequests.set(handler.response!, {
        reject,
        resolve,
        timeout: setTimeout(() => {
          this.waitingRequests.delete(handler.response!);
          reject(new PeerRequestTimeoutError(`MsgQueue timeout request: ${method}`));
        }, 8000)
      });
      this.queue.push(handler.encode(this.makeMessageInfo(), data));
    });
  }

  private async *generator() {
    while (!this.aborter.isAborted) {
      const data = await this.queue.next();
      if (this.aborter.isAborted || data === null) {
        return { length: 0 };
      }
      yield data;
    }
  }

  pipeStream(stream: any) {
    if (this.aborter.isAborted) {
      throw new Error('MsgQueue already aborted');
    }
    pipe(this.generator(), stream.sink);

    pipe(stream.source, async (source) => {
      const it = source[Symbol.asyncIterator]();
      while (!this.aborter.isAborted) {
        const result: any = await this.aborter.abortablePromise(it.next());
        if (this.aborter.isAborted) {
          break;
        }
        const { done, value } = result;
        if (done) {
          break;
        }

        try {
          // TODO: fix _bufs.
          const { code, handler, payload } = this.protocol.handle(value._bufs[0]);
          const data = handler.decode(this.makeMessageInfo(), payload);
          if (code === 0) {
            this.emit('status', data);
          } else {
            const request = this.waitingRequests.get(code);
            if (request) {
              clearTimeout(request.timeout);
              this.waitingRequests.delete(code);
              request.resolve(data);
            } else if (handler.process) {
              const result = handler.process(this.makeMessageInfo(), data);
              if (result) {
                if (Array.isArray(result)) {
                  const [method, resps] = result;
                  this.send(method, resps);
                } else {
                  result
                    .then(([method, resps]) => {
                      this.send(method, resps);
                    })
                    .catch((err) => {
                      this.emit('error', err);
                    });
                }
              }
            }
          }
        } catch (err) {
          this.emit('error', err);
        }
      }
    });
  }

  async abort() {
    await this.aborter.abort(new Error('MsgQueue abort'));
    if (this.queue.isWaiting) {
      this.queue.push(null);
    }
    this.queue.clear();

    for (const [response, request] of this.waitingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('MsgQueue abort'));
    }
    this.waitingRequests.clear();
  }
}

export declare interface Peer {
  on(event: 'busy' | 'idle', listener: (type: 'headers' | 'bodies' | 'receipts') => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: string, listener: (message: any, protocol: Protocol) => void): this;

  once(event: 'busy' | 'idle', listener: (type: 'headers' | 'bodies' | 'receipts') => void): this;
  once(event: 'error', listener: (err: Error) => void): this;
  once(event: string, listener: (message: any, protocol: Protocol) => void): this;
}

export class Peer extends EventEmitter {
  readonly peerId: string;
  readonly node: Libp2pNode;
  private queueMap = new Map<string, MsgQueue>();
  private knowTxs = new Set<Buffer>();
  private knowBlocks = new Set<Buffer>();

  private _headersIdle: boolean = true;
  private _bodiesIdle: boolean = true;
  private _receiptsIdle: boolean = true;

  constructor(options: { peerId: string; node: Libp2pNode }) {
    super();
    this.peerId = options.peerId;
    this.node = options.node;
  }

  get headersIdle() {
    return this._headersIdle;
  }
  get bodiesIdle() {
    return this._bodiesIdle;
  }
  get receiptsIdle() {
    return this._receiptsIdle;
  }
  set headersIdle(b: boolean) {
    if (this._headersIdle !== b) {
      this._headersIdle = b;
      this.emit(b ? 'idle' : 'busy', 'headers');
    }
  }
  set bodiesIdle(b: boolean) {
    if (this._bodiesIdle !== b) {
      this._bodiesIdle = b;
      this.emit(b ? 'idle' : 'busy', 'bodies');
    }
  }
  set receiptsIdle(b: boolean) {
    if (this._receiptsIdle !== b) {
      this._receiptsIdle = b;
      this.emit(b ? 'idle' : 'busy', 'receipts');
    }
  }

  private makeQueue(protocol: Protocol) {
    const queue = new MsgQueue(this, protocol);
    queue.on('status', (message) => {
      this.emit(`status:${queue.name}`, message, protocol);
    });
    queue.on('error', (err) => {
      this.emit('error', err);
    });
    this.queueMap.set(queue.name, queue);
    return queue;
  }

  private getQueue(name: string) {
    const queue = this.queueMap.get(name);
    if (!queue) {
      throw new Error(`Peer unkonw name: ${name}`);
    }
    return queue;
  }

  async abort() {
    for (const [name, queue] of this.queueMap) {
      await queue.abort();
    }
    this.queueMap.clear();
  }

  isSupport(name: string): boolean {
    try {
      const status = this.getQueue(name).protocol.status;
      return status !== undefined;
    } catch (err) {
      return false;
    }
  }

  getStatus(name: string): any {
    try {
      return this.getQueue(name).protocol.status;
    } catch (err) {}
  }

  send(name: string, method: string, message: any) {
    this.getQueue(name).send(method, message);
  }

  request(name: string, method: string, message: any) {
    return this.getQueue(name).request(method, message);
  }

  async acceptProtocol(stream: any, protocol: Protocol, status: any): Promise<boolean> {
    const queue = this.makeQueue(protocol);
    queue.pipeStream(stream);
    return await protocol.handshake(this, status);
  }

  async installProtocol(p2p: any, peerInfo: PeerId, protocol: Protocol, status: any): Promise<boolean> {
    const { stream } = await p2p.dialProtocol(peerInfo, protocol.protocolString);
    const queue = this.makeQueue(protocol);
    queue.pipeStream(stream);
    return await protocol.handshake(this, status);
  }

  async installProtocols(p2p: any, peerInfo: PeerId, protocols: Protocol[], status: any) {
    await Promise.all(protocols.map((p) => this.installProtocol(p2p, peerInfo, p, status)));
  }

  //////////// Protocol method ////////////
  newBlock(block: Block) {
    const hash = block.header.hash();
    if (this.knowBlocks.has(hash)) {
      return;
    }
    this.knowBlocks.add(hash);
    // TODO: config this.
    if (this.knowBlocks.size > 1024) {
      const itr = this.knowBlocks.keys();
      this.knowBlocks.delete(itr.next().value);
    }
    this.send(constants.GXC2_ETHWIRE, 'NewBlock', { block });
  }

  newBlockHashes(hashes: Buffer[]) {
    const filteredHashes: Buffer[] = [];
    for (const hash of hashes) {
      if (!this.knowBlocks.has(hash)) {
        filteredHashes.push(hash);
        this.knowBlocks.add(hash);
      }
    }
    // TODO: config this.
    while (this.knowBlocks.size > 1024) {
      const itr = this.knowBlocks.keys();
      this.knowBlocks.delete(itr.next().value);
    }
    this.send(constants.GXC2_ETHWIRE, 'NewBlockHashes', { hashes: filteredHashes });
  }

  transactions(txs: Transaction[]) {
    const filteredTxs: Transaction[] = [];
    for (const tx of txs) {
      const hash = tx.hash();
      if (!this.knowTxs.has(hash)) {
        filteredTxs.push(tx);
        this.knowTxs.add(hash);
      }
    }
    // TODO: config this.
    while (this.knowTxs.size > 32768) {
      const itr = this.knowTxs.keys();
      this.knowTxs.delete(itr.next().value);
    }
    this.send(constants.GXC2_ETHWIRE, 'Transactions', { txs: filteredTxs });
  }

  getBlockHeaders(start: number, count: number): Promise<BlockHeader[]> {
    return this.request(constants.GXC2_ETHWIRE, 'GetBlockHeaders', { start, count });
  }

  getBlockBodies(headers: BlockHeader[]): Promise<Transaction[][]> {
    return this.request(constants.GXC2_ETHWIRE, 'GetBlockBodies', headers);
  }
}
