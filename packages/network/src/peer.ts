import pipe from 'it-pipe';
import { Channel, logger, ignoreError } from '@rei-network/utils';
import { NetworkManager } from './index';
import { Protocol, ProtocolHandler } from './types';

/**
 * A message queue for a single protocol
 */
export class MsgQueue {
  readonly handler: ProtocolHandler;
  private readonly peer: Peer;
  private readonly queue: Channel;
  private readonly protocolString: string;
  private aborted: boolean = false;
  private stream?: any;
  private streamPromise?: Promise<void>;

  constructor(peer: Peer, handler: ProtocolHandler, protocolString: string) {
    this.peer = peer;
    this.handler = handler;
    this.protocolString = protocolString;
    this.queue = new Channel({
      drop: async (data: any) => {
        if (!this.aborted) {
          this.aborted = true;
          logger.warn('MsgQueue::drop, peer:', this.peer.peerId, 'protocol:', protocolString, 'message queue too large, droped:', data);
          await this.peer.close();
        }
      },
      max: 50
    });
  }

  /**
   * Push a data to message queue
   * @param method - Method name or code
   * @param data - Method data
   */
  send(data: any) {
    if (!this.aborted) {
      this.queue.push(data);
    }
  }

  /**
   * Return an async generator for writing data from message queue to to the `libp2p` stream
   */
  private async *generator() {
    const gen = this.queue[Symbol.asyncIterator]();
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
        // ignore all errors ...
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
    logger.info('🤐 Protocol uninstalled peer:', this.peer.peerId, 'protocol:', this.protocolString);
  }
}

export enum PeerStatus {
  Connected,
  Installing,
  Installed
}

/**
 * Peer class manages a single remote peer instance
 */
export class Peer {
  readonly peerId: string;
  status: PeerStatus = PeerStatus.Connected;
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
  private async makeMsgQueue(protocol: Protocol): Promise<{
    queue: MsgQueue;
    handler: ProtocolHandler;
  } | null> {
    if (!(await protocol.beforeMakeHandler(this))) {
      return null;
    }
    const oldQueue = this.queueMap.get(protocol.protocolString);
    if (oldQueue) {
      await oldQueue.abort();
    }
    const handler = protocol.makeHandler(this);
    const queue = new MsgQueue(this, handler, protocol.protocolString);
    this.queueMap.set(protocol.protocolString, queue);
    return { queue, handler };
  }

  /**
   * Get the message queue by protocol name
   * @param str - Protocol string
   * @returns Message queue
   */
  getMsgQueue(str: string) {
    const queue = this.queueMap.get(str);
    if (!queue) {
      throw new Error(`Peer unknown protocol string: ${str}`);
    }
    return queue;
  }

  /**
   * Send data for target protocol
   * @param str - Target protocol string
   * @param data - Data
   */
  send(str: string, data: any) {
    this.getMsgQueue(str).send(data);
  }

  /**
   * Close self
   */
  async close() {
    await this.networkMngr.removePeer(this.peerId);
  }

  /**
   * Abort peer
   */
  async abort() {
    await ignoreError(Promise.all(Array.from(this.queueMap.values()).map((queue) => queue.abort())));
    this.queueMap.clear();
  }

  /**
   * Query whether a protocol is supported
   * @param str - Protocol string
   * @returns `true` if supported, `false` if not
   */
  isSupport(str: string): boolean {
    return this.queueMap.has(str);
  }

  /**
   * Make message queue for protocol and handshake
   * @param protocol - Protocol object
   * @param stream - `libp2p` stream
   * @returns Whether the handshake was successful
   */
  async installProtocol(protocol: Protocol, stream: any): Promise<{ success: boolean; handler?: ProtocolHandler }> {
    const result = await this.makeMsgQueue(protocol);
    if (!result) {
      return { success: false };
    }
    const { queue, handler } = result;
    queue.pipeStream(stream);
    let handshakeResult: undefined | boolean;
    try {
      handshakeResult = await handler.handshake();
      if (!handshakeResult) {
        throw new Error(`protocol ${protocol.protocolString}, handshake failed`);
      }
      return { success: true, handler };
    } catch (err) {
      if (handshakeResult === undefined) {
        logger.warn('Peer::installProtocol, handshake failed with remote peer:', this.peerId);
      }
      await queue.abort();
      this.queueMap.delete(protocol.protocolString);
      return { success: false };
    }
  }

  /**
   * Uninstall protocol
   * @param str - Protocol string
   * @returns If succeed, return true
   */
  async uninstallProtocol(str: string) {
    const queue = this.queueMap.get(str);
    if (queue) {
      await queue.abort();
      this.queueMap.delete(str);
      return true;
    }
    return false;
  }

  updateTimestamp(timestamp: number = Date.now()) {
    this.networkMngr.updateTimestamp(this.peerId, timestamp);
  }
}
