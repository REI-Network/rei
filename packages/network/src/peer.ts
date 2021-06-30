import pipe from 'it-pipe';
import { Channel, logger } from '@gxchain2/utils';
import { NetworkManager } from './index';
import { Protocol, ProtocolHandler } from './types';

let iii = 0;

export class MsgQueue {
  readonly handler: ProtocolHandler;
  private readonly peer: Peer;
  private readonly queue: Channel;
  private aborted: boolean = false;
  private stream?: any;
  private streamPromise?: Promise<void>;

  constructor(peer: Peer, handler: ProtocolHandler) {
    this.peer = peer;
    this.handler = handler;
    this.queue = new Channel({
      drop: async (data: any) => {
        if (!this.aborted) {
          this.aborted = true;
          logger.warn('MsgQueue::drop, Peer:', this.peer.peerId, 'message queue too large, droped:', data);
          await this.peer.close();
        }
      },
      max: 50
    });
  }

  send(method: string | number, data: any) {
    if (this.aborted) {
      throw new Error('MsgQueue already aborted');
    }
    data = this.handler.encode(method, data);
    this.queue.push(data);
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
    if (this.aborted) {
      throw new Error('MsgQueue already aborted');
    }
    if (this.stream || this.streamPromise) {
      throw new Error('MsgQueue already piped');
    }
    this.stream = stream;
    this.streamPromise = (async () => {
      try {
        let local = iii++;
        const sinkPromise = pipe(this.generator(), stream.sink);
        const sourcePromise = pipe(stream.source, async (source) => {
          for await (const data of source as AsyncGenerator<{ _bufs: Buffer[] }, any, any>) {
            try {
              if (this.aborted) {
                break;
              }
              const buf = data._bufs.reduce((buf1, buf2) => Buffer.concat([buf1, buf2]));
              await this.handler.handle(buf);
              this.peer.updateTimestamp();
            } catch (err) {
              logger.error('MsgQueue::pipeStream, handle message error:', err);
              await this.peer.close();
            }
          }
        });
        console.log('start wait stream', local, this.peer.peerId);
        await Promise.all([sinkPromise, sourcePromise]);
        console.log('stop wait stream', local, this.peer.peerId);
      } catch (err) {
        logger.error('MsgQueue::pipeStream, pipe error:', err);
      }
    })();
  }

  async abort() {
    this.aborted = true;
    this.queue.abort();
    if (this.stream) {
      this.stream.close();
      this.stream = undefined;
    }
    if (this.streamPromise) {
      await this.streamPromise;
      this.streamPromise = undefined;
    }
    this.handler.abort();
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

  private async makeMsgQueue(protocol: Protocol) {
    const oldQueue = this.queueMap.get(protocol.name);
    if (oldQueue) {
      await oldQueue.abort();
    }
    const handler = protocol.makeHandler(this);
    const queue = new MsgQueue(this, handler);
    this.queueMap.set(protocol.name, queue);
    return { queue, handler };
  }

  getMsgQueue(name: string) {
    const queue = this.queueMap.get(name);
    if (!queue) {
      throw new Error(`Peer unkonw name: ${name}`);
    }
    return queue;
  }

  async close() {
    await this.networkMngr.removePeer(this.peerId);
  }

  async abort() {
    await Promise.all(Array.from(this.queueMap.values()).map((queue) => queue.abort()));
    this.queueMap.clear();
  }

  isSupport(name: string): boolean {
    return this.queueMap.has(name);
  }

  async installProtocol(protocol: Protocol, stream: any) {
    const { queue, handler } = await this.makeMsgQueue(protocol);
    queue.pipeStream(stream);
    try {
      if (!(await handler.handshake())) {
        throw new Error(`protocol ${protocol.name}, handshake failed`);
      }
      return true;
    } catch (err) {
      await queue.abort();
      this.queueMap.delete(protocol.name);
      logger.error('Peer::installProtocol, catch error:', err);
      return false;
    }
  }

  updateTimestamp(timestamp: number = Date.now()) {
    this.networkMngr.updateTimestamp(this.peerId, timestamp);
  }
}
