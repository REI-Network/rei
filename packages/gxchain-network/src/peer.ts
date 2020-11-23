import pipe from 'it-pipe';

import { Peer } from '@gxchain2/interface';

type MsgObject = {
  data: string;
  resolve?: () => void;
  reject?: (reason?: any) => void;
};

export default class PeerImpl implements Peer {
  private abortResolve!: () => void;
  private abortPromise = new Promise<void>((resolve) => {
    this.abortResolve = resolve;
  });
  private abortFlag: boolean = false;

  private msgQueue: MsgObject[] = [];
  private msgQueueResolve: ((msg: MsgObject) => void) | undefined;
  private msgQueueReject: ((reason?: any) => void) | undefined;

  private jsonRPCId: number = 0;
  private jsonRPCRequestMap = new Map<string, [(params: any) => void, (reason?: any) => void, any]>();
  private jsonRPCMsgHandler: (peer: Peer, method: string, params?: any) => Promise<any> | any;

  private peerId: string;
  private writing: boolean = false;
  private reading: boolean = false;

  constructor(peerId: string, jsonRPCMsgHandler: (peer: Peer, method: string, params?: any) => Promise<any> | any) {
    this.peerId = peerId;
    this.jsonRPCMsgHandler = jsonRPCMsgHandler;
  }

  getPeerId() {
    return this.peerId;
  }

  pipeWriteStream(stream: any) {
    this.writing = true;
    pipe(this._makeAsyncGenerator(), stream.sink);
  }

  pipeReadStream(stream: any) {
    this.reading = true;
    pipe(stream.source, async (source) => {
      const it = source[Symbol.asyncIterator]();
      while (!this.abortFlag) {
        const result = await Promise.race([this.abortPromise, it.next()]);
        if (this.abortFlag) break;
        const { done, value } = result;
        if (done) break;
        this.jsonRPCReceiveMsg(value);
      }
    });
  }

  isWriting() {
    return this.writing;
  }

  isReading() {
    return this.reading;
  }

  abort() {
    this.abortFlag = true;
    this.abortResolve();
    if (this.msgQueueReject) {
      this.msgQueueReject(new Error('msg queue abort'));
      this.msgQueueReject = undefined;
      this.msgQueueResolve = undefined;
    }
    for (const msgObject of this.msgQueue) {
      if (msgObject.reject) {
        msgObject.reject(new Error('msg queue abort'));
      }
    }
    this.msgQueue = [];

    for (const [idString, [resolve, reject, handler]] of this.jsonRPCRequestMap) {
      clearTimeout(handler);
      reject(new Error('jsonrpc abort'));
    }
    this.jsonRPCRequestMap.clear();
  }

  private _addToQueue(msg: MsgObject) {
    if (this.msgQueueResolve) {
      this.msgQueueResolve(msg);
      this.msgQueueResolve = undefined;
      this.msgQueueReject = undefined;
    } else {
      this.msgQueue.push(msg);
      if (this.msgQueue.length > 10) {
        console.warn('\n$ Drop message:', this.msgQueue.shift()!.data);
      }
    }
  }

  addToQueue(msgData: string, waiting: boolean = false) {
    return waiting
      ? new Promise<void>((resolve, reject) => {
          const msgObject: MsgObject = {
            data: msgData,
            resolve,
            reject
          };
          this._addToQueue(msgObject);
        })
      : this._addToQueue({
          data: msgData
        });
  }

  private async *_makeAsyncGenerator() {
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

  jsonRPCRequest(method: string, params?: any, timeout = 5000) {
    const idString = `${++this.jsonRPCId}`;
    const req = {
      jsonrpc: '2.0',
      id: idString,
      method,
      params
    };
    this.addToQueue(JSON.stringify(req));
    return new Promise<any>((resolve, reject) => {
      this.jsonRPCRequestMap.set(idString, [
        resolve,
        reject,
        setTimeout(() => {
          if (this.jsonRPCRequestMap.has(idString)) {
            this.jsonRPCRequestMap.delete(idString);
            reject(new Error('jsonrpc timeout'));
          }
        }, timeout)
      ]);
    });
  }

  private _jsonRPCNotify(id: string, method?: string, params?: any, waiting: boolean = false) {
    const req = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };
    return this.addToQueue(JSON.stringify(req), waiting);
  }

  jsonRPCNotify(method: string, params?: any, waiting?: false): void;
  jsonRPCNotify(method: string, params?: any, waiting?: true): Promise<void>;
  jsonRPCNotify(method: string, params?: any, waiting?: boolean): Promise<void> | void;
  jsonRPCNotify(method: string, params?: any, waiting: boolean = false) {
    return this._jsonRPCNotify(`${++this.jsonRPCId}`, method, params, waiting);
  }

  jsonRPCReceiveMsg(data: any) {
    try {
      const obj = JSON.parse(data);
      const info = this.jsonRPCRequestMap.get(obj.id);
      if (info) {
        const [resolve, reject, handler] = info;
        clearTimeout(handler);
        resolve(obj.params);
        this.jsonRPCRequestMap.delete(obj.id);
      } else {
        let result = this.jsonRPCMsgHandler(this, obj.method, obj.params);
        if (result !== undefined) {
          if (result.then === undefined) {
            result = Promise.resolve(result);
          }
          result.then((params) => {
            if (params !== undefined) {
              this._jsonRPCNotify(obj.id, undefined, params);
            }
          });
        }
      }
    } catch (err) {
      console.error('\n$ Error, handleMsg', err);
    }
  }
}
