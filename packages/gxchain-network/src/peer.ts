import { EventEmitter } from 'events';

import pipe from 'it-pipe';
import type PeerId from 'peer-id';
import { bufferToInt, rlp } from 'ethereumjs-util';

import { Protocol } from './protocol/protocol';

declare interface MsgQueue {
  on(event: 'message' | 'status', listener: (queue: MsgQueue, message: any) => void): this;
  once(event: 'message' | 'status', listener: (queue: MsgQueue, message: any) => void): this;
}

class MsgQueue extends EventEmitter {
  private abortResolve!: () => void;
  private abortPromise = new Promise<void>((resolve) => {
    this.abortResolve = resolve;
  });
  private abortFlag: boolean = false;

  private queue: any[] = [];
  private queueResolve?: (data: any) => void;
  private queueReject?: (reason?: any) => void;

  readonly protocol: Protocol;

  private readonly waitingRequests = new Map<
    number,
    {
      resolve: (data: any) => void;
      reject: (reason?: any) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(protocol: Protocol) {
    super();
    this.protocol = protocol;
  }

  get name() {
    return this.protocol.name;
  }

  private _enqueue(data: any) {
    if (this.queueResolve) {
      this.queueResolve(data);
      this.queueResolve = undefined;
      this.queueReject = undefined;
    } else {
      this.queue.push(data);
      if (this.queue.length > 10) {
        console.warn('MsgQueue drop message:', this.queue.shift());
      }
    }
  }

  send(method: string, data: any) {
    return this._enqueue(this.protocol.encode(method, data));
  }

  request(method: string, data: any) {
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
          reject(new Error(`MsgQueue timeout request: ${method}`));
        }, 8000)
      });
      this._enqueue(handler.encode(data));
    });
  }

  private async *makeAsyncGenerator() {
    while (!this.abortFlag) {
      const p =
        this.queue.length > 0
          ? Promise.resolve(this.queue.shift()!)
          : new Promise<any>((resolve, reject) => {
              this.queueResolve = resolve;
              this.queueReject = reject;
            });
      yield p.catch(() => {
        return { length: 0 };
      });
    }
  }

  pipeStream(stream: any) {
    pipe(this.makeAsyncGenerator(), stream.sink);

    pipe(stream.source, async (source) => {
      const it = source[Symbol.asyncIterator]();
      while (!this.abortFlag) {
        const result = await Promise.race([this.abortPromise, it.next()]);
        if (this.abortFlag) break;
        const { done, value } = result;
        if (done) break;

        let [code, payload]: any = rlp.decode(value);
        code = bufferToInt(code);
        try {
          if (code === 0) {
            this.emit('status', this, this.protocol.decodeStatus(payload));
          } else {
            const request = this.waitingRequests.get(code);
            if (request) {
              clearTimeout(request.timeout);
              this.waitingRequests.delete(code);
              request.resolve(this.protocol.decode(code, payload));
            } else {
              this.emit('message', this, this.protocol.decode(code, payload));
            }
          }
        } catch (err) {
          this.emit('error', this, err);
        }
      }
    });
  }

  abort() {
    this.abortFlag = true;
    this.abortResolve();
    if (this.queueReject) {
      this.queueReject(new Error('MsgQueue abort'));
      this.queueReject = undefined;
      this.queueResolve = undefined;
    }
    this.queue = [];

    for (const [response, request] of this.waitingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('MsgQueue abort'));
    }
    this.waitingRequests.clear();
  }
}

export declare interface Peer {
  on(event: string, listener: (peer: Peer, message: any) => void): this;
  once(event: string, listener: (peer: Peer, message: any) => void): this;
}

export class Peer extends EventEmitter {
  readonly peerId: string;
  private queueMap = new Map<string, MsgQueue>();

  constructor(peerId: string) {
    super();
    this.peerId = peerId;
  }

  private makeQueue(protocol: Protocol) {
    const queue = new MsgQueue(protocol);
    queue.on('status', (q, message) => {
      this.emit(`status:${q.name}`, this, message);
    });
    queue.on('message', (q, message) => {
      this.emit('message', this, message);
      this.emit(`message:${q.name}`, this, message);
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

  abort() {
    for (const [name, queue] of this.queueMap) {
      queue.abort();
    }
    this.queueMap.clear();
  }

  best(name: string): number {
    const status = this.getQueue(name).protocol.status;
    if (!status || status.height === undefined) {
      throw new Error(`Peer invalid status, name: ${name}`);
    }
    return status.height;
  }

  send(name: string, method: string, message: any) {
    this.getQueue(name).send(method, message);
  }

  request(name: string, method: string, message: any) {
    return this.getQueue(name).request(method, message);
  }

  async acceptProtocol(stream: any, protocol: Protocol, status: any) {
    const queue = this.makeQueue(protocol);
    queue.pipeStream(stream);
    await protocol.handshake(this, status);
  }

  async installProtocol(p2p: any, peerInfo: PeerId, protocol: Protocol, status: any) {
    const { stream } = await p2p.dialProtocol(peerInfo, protocol.protocolString);
    const queue = this.makeQueue(protocol);
    queue.pipeStream(stream);
    await protocol.handshake(this, status);
  }

  async installProtocols(p2p: any, peerInfo: PeerId, protocols: Protocol[], status: any) {
    await Promise.all(protocols.map((p) => this.installProtocol(p2p, peerInfo, p, status)));
  }
}
