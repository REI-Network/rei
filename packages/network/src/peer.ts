import pipe from 'it-pipe';
import { Channel, logger } from '@gxchain2/utils';
import { NetworkManager, logNetworkError } from './index';
import { Protocol, ProtocolHandler } from './types';

/**
 * A message queue for a single protocol
 */
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

  /**
   * Encode and push a data to message queue
   * @param method - Method name or code
   * @param data - Method data
   */
  send(method: string | number, data: any) {
    if (this.aborted) {
      throw new Error('MsgQueue already aborted');
    }
    data = this.handler.encode(method, data);
    this.queue.push(data);
  }

  /**
   * Return an async generator for writing data from message queue to to the `libp2p` stream
   */
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

  /**
   * Pipe `libp2p` stream's sink and source
   * @param stream - `libp2p` stream
   */
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
        await Promise.all([sinkPromise, sourcePromise]);
      } catch (err) {
        logNetworkError('MsgQueue::pipeStream', err);
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

/**
 * Peer class manages a single remote peer instance
 */
export class Peer {
  readonly peerId: string;
  private readonly networkMngr: NetworkManager;
  private readonly queueMap = new Map<string, MsgQueue>();

  constructor(peerId: string, networkMngr: NetworkManager) {
    this.peerId = peerId;
    this.networkMngr = networkMngr;
  }

  /**
   * Create a message queue object by protocol
   * @param protocol - Protocol object
   * @returns Message queue and protocol handler
   */
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

  /**
   * Get the message queue by protocol name
   * @param name - Protocol name
   * @returns Message queue
   */
  getMsgQueue(name: string) {
    const queue = this.queueMap.get(name);
    if (!queue) {
      throw new Error(`Peer unkonw name: ${name}`);
    }
    return queue;
  }

  /**
   * Close self
   */
  async close() {
    await this.networkMngr.removePeer(this.peerId);
  }

  async abort() {
    await Promise.all(Array.from(this.queueMap.values()).map((queue) => queue.abort()));
    this.queueMap.clear();
  }

  /**
   * Query whether a protocol is supported
   * @param name - Protocol name
   * @returns `true` if supported, `false` if not
   */
  isSupport(name: string): boolean {
    return this.queueMap.has(name);
  }

  /**
   * Make message queue for protocol and handshake
   * @param protocol - Protocol object
   * @param stream - `libp2p` stream
   * @returns Whether the handshake was successful
   */
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
      return false;
    }
  }

  updateTimestamp(timestamp: number = Date.now()) {
    this.networkMngr.updateTimestamp(this.peerId, timestamp);
  }
}
