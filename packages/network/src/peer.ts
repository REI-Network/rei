import pipe from 'it-pipe';
import { Channel, Aborter, logger } from '@gxchain2/utils';
import { NetworkManager } from './index';
import { Protocol, ProtocolHandler } from './types';

export class PeerRequestTimeoutError extends Error {}

declare interface MsgQueue {
  on(event: 'status', listener: (message: any) => void): this;
  on(event: 'error', listener: (error: any) => void): this;

  once(event: 'status', listener: (message: any) => void): this;
  once(event: 'error', listener: (error: any) => void): this;
}

class MsgQueue {
  private readonly peer: Peer;
  private readonly aborter: Aborter;
  private readonly queue: Channel;
  private readonly handler: ProtocolHandler;

  constructor(peer: Peer, handler: ProtocolHandler) {
    this.peer = peer;
    this.handler = handler;
    this.aborter = new Aborter();
    this.queue = new Channel({
      drop: async (data: any) => {
        logger.warn('MsgQueue::drop, Peer', this.peer.peerId, 'message queue too large, droped');
        await this.peer.close();
      },
      max: 50
    });
  }

  send(method: string, data: any) {
    if (this.aborter.isAborted) {
      throw new Error('MsgQueue already aborted');
    }
    data = this.handler.encode(method, data);
    this.queue.push(data);
  }

  request(method: string, data: any) {
    this.send(method, data);
    return new Promise<any>((resolve, reject) => {
      this.handler.waiting(method, data, resolve, reject);
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
        try {
          const result: any = await this.aborter.abortablePromise(it.next());
          if (this.aborter.isAborted) {
            break;
          }
          const { done, value } = result;
          if (done) {
            break;
          }

          const data: Buffer = value._bufs[0];
          await this.handler.handle(data);
        } catch (err) {
          logger.error('MsgQueue::pipeStream, handle message error:', err);
        }
      }
    });
  }

  async abort() {
    this.queue.abort();
    await this.handler.abort();
    await this.aborter.abort();
  }
}

export class Peer {
  readonly peerId: string;
  private readonly networkMngr: NetworkManager;
  private readonly queueMap = new Map<string, MsgQueue>();

  constructor(peerId: string, networkMngr: NetworkManager) {
    this.peerId = peerId;
    this.networkMngr = networkMngr;
  }

  private makeMsgQueue(protocol: Protocol) {
    const handler = protocol.makeHandler();
    const queue = new MsgQueue(this, handler);
    this.queueMap.set(protocol.name, queue);
    return { queue, handler };
  }

  private getMsgQueue(name: string) {
    const queue = this.queueMap.get(name);
    if (!queue) {
      throw new Error(`Peer unkonw name: ${name}`);
    }
    return queue;
  }

  async close() {
    await this.networkMngr.removePeer(this);
  }

  async abort() {
    await Promise.all(Array.from(this.queueMap.values()).map((queue) => queue.abort()));
    this.queueMap.clear();
  }

  isSupport(name: string): boolean {
    try {
      this.getMsgQueue(name);
      return true;
    } catch (err) {
      return false;
    }
  }

  send(name: string, method: string, data: any) {
    this.getMsgQueue(name).send(method, data);
  }

  request(name: string, method: string, data: any) {
    return this.getMsgQueue(name).request(method, data);
  }

  async installProtocol(protocol: Protocol, stream?: any) {
    const { queue, handler } = this.makeMsgQueue(protocol);
    queue.pipeStream(stream);
    try {
      if (!(await handler.handshake())) {
        throw new Error(`protocol ${protocol.name}, handshake failed`);
      }
      return true;
    } catch (err) {
      await queue.abort();
      this.queueMap.delete(protocol.name);
      return false;
    }
  }
}
