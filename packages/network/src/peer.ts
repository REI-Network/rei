import pipe from 'it-pipe';
import { Channel, Aborter, logger } from '@gxchain2/utils';
import { NetworkManager } from './index';
import { Protocol, ProtocolHandler } from './types';

/**
 * MsgQueue has the protocol processing method and maintain a message transmission queue
 */
export class MsgQueue {
  readonly handler: ProtocolHandler;
  private readonly peer: Peer;
  private readonly aborter: Aborter;
  private readonly queue: Channel;

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

  /**
   * Push the coding results of methods and data into the queue
   * @param method The method's name
   * @param data The data
   */
  send(method: string | number, data: any) {
    if (this.aborter.isAborted) {
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
    this.handler.abort();
    await this.aborter.abort();
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
   * @param protocol Protocol infomation
   * @returns The object of MsgQueue and ProtocolHandler
   */
  private makeMsgQueue(protocol: Protocol) {
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
    await this.networkMngr.removePeer(this);
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
   * Receive protocol and stream infomation, install protocol, determine
   * and return whether the handshake is successful
   * @param protocol Protocol infomation
   * @param stream Information transmission structure
   * @returns `true` if the protocol is installed successfully, `false`
   * if not
   */
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
