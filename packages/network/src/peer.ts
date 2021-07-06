import pipe from 'it-pipe';
import { Channel, logger } from '@gxchain2/utils';
import { NetworkManager } from './index';
import { Protocol, ProtocolHandler } from './types';

/**
 * MsgQueue has the protocol processing method and maintain a message transmission queue
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
   * Push the coding results of methods and data into the queue
   * @param method The method's name
   * @param data The data
   */
  send(method: string | number, data: any) {
    if (this.aborted) {
      throw new Error('MsgQueue already aborted');
    }
    data = this.handler.encode(method, data);
    this.queue.push(data);
  }

  /**
   * Iterator function, used to get the message data in the queue
   * @returns Empty array if no data left
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
   * Pipe transmission of stream information, then handle the data
   * @param stream Information transmission structure
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

/**
 * Peer is a class manage communications
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
   * Create a MsgQueue object, and push it into the queueMap
   * @param protocol Protocol information
   * @returns The object of MsgQueue and ProtocolHandler
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
   * Get the MsgQueue from the queue map
   * @param name The protocol's name
   * @returns The MsgQueue object
   */
  getMsgQueue(name: string) {
    const queue = this.queueMap.get(name);
    if (!queue) {
      throw new Error(`Peer unkonw name: ${name}`);
    }
    return queue;
  }

  /**
   * Close node communication and remove the peer
   */
  async close() {
    await this.networkMngr.removePeer(this.peerId);
  }

  async abort() {
    await Promise.all(Array.from(this.queueMap.values()).map((queue) => queue.abort()));
    this.queueMap.clear();
  }

  /**
   * Query whether a certain protocol is supported
   * @param name The protocol's name
   * @returns `true` if supported, `false` not
   */
  isSupport(name: string): boolean {
    return this.queueMap.has(name);
  }

  /**
   * Receive protocol and stream information, install protocol, determine
   * and return whether the handshake is successful
   * @param protocol Protocol information
   * @param stream Information transmission structure
   * @returns `true` if the protocol is installed successfully, `false`
   * if not
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
      logger.error('Peer::installProtocol, catch error:', err);
      return false;
    }
  }

  updateTimestamp(timestamp: number = Date.now()) {
    this.networkMngr.updateTimestamp(this.peerId, timestamp);
  }
}
