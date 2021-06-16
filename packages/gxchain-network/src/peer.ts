import { EventEmitter } from 'events';
import { BN } from 'ethereumjs-util';
import { Channel, Aborter, createBufferFunctionalSet, logger } from '@gxchain2/utils';
import { Block, BlockHeader } from '@gxchain2/block';
import { Transaction } from '@gxchain2/tx';
import { constants } from '@gxchain2/common';
import pipe from 'it-pipe';
import type PeerId from 'peer-id';
import { Protocol, ETHProtocol } from './protocol';
import { Libp2pNode } from './libp2pnode';
import type { INode } from './types';

const txsyncPackSize = 102400;

export class PeerRequestTimeoutError extends Error {}

export type MsgContext = {
  node: INode;
  peer: Peer;
  protocol: Protocol;
};

function makeProtocol(name: string): Protocol {
  if (name === constants.GXC2_ETHWIRE) {
    return new ETHProtocol();
  }
  throw new Error(`Unkonw protocol: ${name}`);
}

declare interface MsgQueue {
  on(event: 'status', listener: (message: any) => void): this;
  on(event: 'error', listener: (error: any) => void): this;

  once(event: 'status', listener: (message: any) => void): this;
  once(event: 'error', listener: (error: any) => void): this;
}

class MsgQueue extends EventEmitter {
  private readonly peer: Peer;
  private readonly aborter: Aborter;
  private readonly queue: Channel;
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
    this.aborter = new Aborter();
    this.queue = new Channel({
      drop: (data: any) => {
        logger.warn('Peer close self:', this.peer.peerId);
        this.peer.libp2pNode.removePeer(this.peer);
      }
    });
  }

  get name() {
    return this.protocol.name;
  }

  private makeContext(): MsgContext {
    return {
      node: this.peer.libp2pNode.node,
      peer: this.peer,
      protocol: this.protocol
    };
  }

  send(method: string, data: any) {
    if (!this.aborter.isAborted) {
      const handler = this.protocol.findHandler(method);
      this.queue.push(handler.encode(this.makeContext(), data));
    }
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
      this.queue.push(handler.encode(this.makeContext(), data));
    });
  }

  private async *generator() {
    const gen = this.queue.generator();
    while (true) {
      const { value } = await gen.next();
      if (value !== undefined) {
        yield value;
      } else {
        return [];
      }
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
          const data = handler.decode(this.makeContext(), payload);
          if (code === 0) {
            this.emit('status', data);
          } else {
            const request = this.waitingRequests.get(code);
            if (request) {
              clearTimeout(request.timeout);
              this.waitingRequests.delete(code);
              request.resolve(data);
            } else if (handler.process) {
              const result = handler.process(this.makeContext(), data);
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
    this.queue.abort();
    for (const [response, request] of this.waitingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('MsgQueue abort'));
    }
    this.waitingRequests.clear();
    await this.aborter.abort();
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
  readonly libp2pNode: Libp2pNode;
  private queueMap = new Map<string, MsgQueue>();
  private knowTxs = createBufferFunctionalSet();
  private knowBlocks = createBufferFunctionalSet();

  private _headersIdle: boolean = true;
  private _bodiesIdle: boolean = true;
  private _receiptsIdle: boolean = true;

  private newBlockAnnouncesQueue: Channel<{ block: Block; td: BN }>;
  private txAnnouncesQueue: Channel<Buffer>;

  constructor(options: { peerId: string; libp2pNode: Libp2pNode }) {
    super();
    this.peerId = options.peerId;
    this.libp2pNode = options.libp2pNode;
    this.newBlockAnnouncesQueue = new Channel<{ block: Block; td: BN }>({ max: 1 });
    this.txAnnouncesQueue = new Channel<Buffer>();
    this.newBlockAnnouncesLoop();
    this.txAnnouncesLoop();
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

  private async newBlockAnnouncesLoop() {
    for await (const { block, td } of this.newBlockAnnouncesQueue.generator()) {
      this.newBlock(block, td);
    }
  }

  private async txAnnouncesLoop() {
    let hashesCache: Buffer[] = [];
    for await (const hash of this.txAnnouncesQueue.generator()) {
      hashesCache.push(hash);
      if (hashesCache.length < txsyncPackSize && this.txAnnouncesQueue.array.length > 0) {
        continue;
      }
      this.newPooledTransactionHashes(hashesCache);
      hashesCache = [];
    }
  }

  private makeMsgQueue(name: string) {
    const protocol = makeProtocol(name);
    const queue = new MsgQueue(this, protocol);
    queue.on('status', (message) => {
      this.emit(`status:${queue.name}`, message, protocol);
    });
    queue.on('error', (err) => {
      this.emit('error', err);
    });
    this.queueMap.set(queue.name, queue);
    return { queue, protocol };
  }

  private getMsgQueue(name: string) {
    const queue = this.queueMap.get(name);
    if (!queue) {
      throw new Error(`Peer unkonw name: ${name}`);
    }
    return queue;
  }

  private filterHash<T>(know: Set<Buffer>, max: number, data: T[], toHash: (t: T) => Buffer) {
    const filtered: T[] = [];
    for (const t of data) {
      const hash = toHash(t);
      if (!know.has(hash)) {
        know.add(hash);
        filtered.push(t);
      }
    }
    while (know.size > max) {
      const itr = know.keys();
      know.delete(itr.next().value);
    }
    return filtered;
  }

  private filterTx<T>(data: T[], toHash: (t: T) => Buffer) {
    return this.filterHash(this.knowTxs, 32768, data, toHash);
  }

  private filterBlock<T>(data: T[], toHash: (t: T) => Buffer) {
    return this.filterHash(this.knowBlocks, 1024, data, toHash);
  }

  async abort() {
    this.newBlockAnnouncesQueue.abort();
    this.txAnnouncesQueue.abort();
    await Promise.all(Array.from(this.queueMap.values()).map((queue) => queue.abort()));
    this.queueMap.clear();
  }

  isSupport(name: string): boolean {
    try {
      const status = this.getMsgQueue(name).protocol.status;
      return status !== undefined;
    } catch (err) {
      return false;
    }
  }

  getStatus(name: string): any {
    try {
      return this.getMsgQueue(name).protocol.status;
    } catch (err) {}
  }

  send(name: string, method: string, message: any) {
    this.getMsgQueue(name).send(method, message);
  }

  request(name: string, method: string, message: any) {
    return this.getMsgQueue(name).request(method, message);
  }

  async acceptProtocol(stream: any, name: string, status: any): Promise<boolean> {
    const { queue, protocol } = this.makeMsgQueue(name);
    queue.pipeStream(stream);
    return await protocol.handshake(this, status);
  }

  async installProtocol(peerId: PeerId, name: string, status: any): Promise<boolean> {
    const { queue, protocol } = this.makeMsgQueue(name);
    const { stream } = await this.libp2pNode.dialProtocol(peerId, protocol.protocolString);
    queue.pipeStream(stream);
    return await protocol.handshake(this, status);
  }

  //////////// Protocol method ////////////
  private newBlock(block: Block, td: BN) {
    const filtered = this.filterBlock([block], (b) => b.hash());
    if (filtered.length > 0) {
      this.send(constants.GXC2_ETHWIRE, 'NewBlock', { block: filtered[0], td });
    }
  }

  private newBlockHashes(hashes: Buffer[]) {
    const filtered = this.filterBlock(hashes, (h) => h);
    if (filtered.length > 0) {
      this.send(constants.GXC2_ETHWIRE, 'NewBlockHashes', filtered);
    }
  }

  private newPooledTransactionHashes(hashes: Buffer[]) {
    const filtered = this.filterTx(hashes, (h) => h);
    if (filtered.length > 0) {
      this.send(constants.GXC2_ETHWIRE, 'NewPooledTransactionHashes', hashes);
    }
  }

  getBlockHeaders(start: number, count: number): Promise<BlockHeader[]> {
    return this.request(constants.GXC2_ETHWIRE, 'GetBlockHeaders', { start, count });
  }

  getBlockBodies(headers: BlockHeader[]): Promise<Transaction[][]> {
    return this.request(constants.GXC2_ETHWIRE, 'GetBlockBodies', headers);
  }

  getPooledTransactions(hashes: Buffer[]): Promise<Transaction[]> {
    return this.request(constants.GXC2_ETHWIRE, 'GetPooledTransactions', hashes);
  }

  ////////////////////////
  announceTx(hashes: Buffer[]) {
    for (const hash of hashes) {
      this.txAnnouncesQueue.push(hash);
    }
  }

  announceNewBlock(block: Block, td: BN) {
    this.newBlockAnnouncesQueue.push({ block, td });
  }
}
