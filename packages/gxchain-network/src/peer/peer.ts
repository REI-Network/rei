import { EventEmitter } from 'events';

import pipe from 'it-pipe';
import type PeerId from 'peer-id';
import { bufferToInt, rlp } from 'ethereumjs-util';

import { Protocol } from '../protocol/protocol';

type MsgObject = {
  data: any;
  resolve?: () => void;
  reject?: (reason?: any) => void;
};

export declare interface Peer {
  on(event: string, listener: (peer: Peer, message: any) => void): this;
  once(event: string, listener: (peer: Peer, message: any) => void): this;
}

export class Peer extends EventEmitter {
  private abortResolve!: () => void;
  private abortPromise = new Promise<void>((resolve) => {
    this.abortResolve = resolve;
  });
  private abortFlag: boolean = false;

  private msgQueue: MsgObject[] = [];
  private msgQueueResolve: ((msg: MsgObject) => void) | undefined;
  private msgQueueReject: ((reason?: any) => void) | undefined;

  readonly peerId: string;
  private protocols = new Map<string, Protocol>();

  constructor(peerId: string) {
    super();
    this.peerId = peerId;
  }

  private _send(msg: MsgObject) {
    if (this.msgQueueResolve) {
      this.msgQueueResolve(msg);
      this.msgQueueResolve = undefined;
      this.msgQueueReject = undefined;
    } else {
      this.msgQueue.push(msg);
      if (this.msgQueue.length > 10) {
        console.warn('Drop message:', this.msgQueue.shift()!.data);
      }
    }
  }

  send(data: any, waiting: boolean = false) {
    return waiting
      ? new Promise<void>((resolve, reject) => {
          const msgObject: MsgObject = {
            data,
            resolve,
            reject
          };
          this._send(msgObject);
        })
      : this._send({ data });
  }

  private async *makeAsyncGenerator() {
    while (!this.abortFlag) {
      const p =
        this.msgQueue.length > 0
          ? Promise.resolve(this.msgQueue.shift()!)
          : new Promise<MsgObject>((resolve, reject) => {
              this.msgQueueResolve = resolve;
              this.msgQueueReject = reject;
            });
      yield p
        .then((msg) => {
          if (msg.resolve) {
            msg.resolve();
          }
          return msg.data;
        })
        .catch(() => {
          return { length: 0 };
        });
    }
  }

  pipeStream(stream: any, protocol: Protocol) {
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
        if (code === 0) {
          this.emit(`status:${protocol.name}`, this, payload);
        } else {
          this.emit('message', this, payload);
        }
      }
    });
  }

  abort() {
    this.abortFlag = true;
    this.abortResolve();
    if (this.msgQueueReject) {
      this.msgQueueReject(new Error('Peer abort'));
      this.msgQueueReject = undefined;
      this.msgQueueResolve = undefined;
    }
    for (const msgObject of this.msgQueue) {
      if (msgObject.reject) {
        msgObject.reject(new Error('Peer abort'));
      }
    }
    this.msgQueue = [];
  }

  async installProtocol(p2p: any, peerInfo: PeerId, protocol: Protocol, status: any) {
    const { stream } = await p2p.dialProtocol(peerInfo, protocol.protocolString);
    this.pipeStream(stream);
    await protocol.handshake(this, status);
    this.protocols.set(protocol.name, protocol);
  }

  async installProtocols(p2p: any, peerInfo: PeerId, protocols: Protocol[], status: any) {
    await Promise.all(protocols.map((p) => this.installProtocol(p2p, peerInfo, p, status)));
  }
}
