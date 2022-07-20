import pipe from 'it-pipe';
import { Channel, logger, ignoreError } from '@rei-network/utils';
import { Connection, Protocol, ProtocolHandler, Stream } from './types';

/**
 * A message stream for a single protocol
 */
export class ProtocolStream {
  private readonly peer: Peer;
  private readonly queue: Channel<Buffer>;
  private readonly protocolString: string;
  private handle!: (data: Buffer) => void | Promise<void>;
  private aborted: boolean = false;
  private stream?: Stream;
  private streamPromise?: Promise<void>;

  constructor(peer: Peer, protocolString: string) {
    this.peer = peer;
    this.protocolString = protocolString;
    this.queue = new Channel<Buffer>({
      drop: async (data) => {
        if (!this.aborted) {
          await this.peer.uninstallProtocol(protocolString);
          logger.warn('ProtocolStream::drop, peer:', this.peer.peerId, 'protocol:', protocolString, 'message queue too large, droped:', data.toString('hex'));
        }
      },
      max: 50
    });
  }

  /**
   * Push a data to message queue
   * @param data - Method data
   */
  send(data: Buffer) {
    this.queue.push(data);
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
   * Connect stream with handler
   * @param handler - protocol handler
   */
  connectHandler(handler: ProtocolHandler) {
    this.handle = (data: Buffer) => handler.handle(data);
  }

  /**
   * Pipe `libp2p` stream's sink and source
   * @param stream - `libp2p` stream
   */
  pipeStream(stream: Stream) {
    if (this.aborted) {
      throw new Error('ProtocolStream already aborted');
    }
    if (this.stream || this.streamPromise) {
      throw new Error('ProtocolStream already piped');
    }
    this.stream = stream;
    this.streamPromise = (async () => {
      try {
        const sinkPromise = pipe(this.generator(), stream.sink);
        const sourcePromise = pipe(stream.source, async (source) => {
          for await (const data of source) {
            try {
              if (this.aborted) {
                break;
              }
              const buffer = data._bufs.reduce((buf1, buf2) => Buffer.concat([buf1, buf2]), Buffer.alloc(0));
              await this.handle(buffer);
            } catch (err) {
              logger.error('ProtocolStream::pipeStream, handle message error:', err);
              await this.abort();
            }
          }
        });
        await Promise.all([sinkPromise, sourcePromise]);
      } catch (err) {
        logger.debug('ProtocolStream::pipeStream, catch error:', err);
      }
    })();
  }

  /**
   * Abort stream
   */
  async abort() {
    if (!this.aborted) {
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
      logger.info('🤐 Peer uninstalled:', this.peer.peerId, 'protocol:', this.protocolString);
    }
  }
}

/**
 * Peer class manages a single remote peer instance
 */
export class Peer {
  connection?: Connection;

  readonly peerId: string;
  readonly createAt: number;
  private readonly protocols = new Map<
    string,
    {
      handler: ProtocolHandler;
      stream: ProtocolStream;
    }
  >();

  constructor(peerId: string, createAt: number = Date.now()) {
    this.peerId = peerId;
    this.createAt = createAt;
  }

  /**
   * Get protocols size
   */
  get size() {
    return this.protocols.size;
  }

  /**
   * Query whether a protocol is supported
   * @param protocolString - Protocol string
   * @returns `true` if supported, `false` if not
   */
  isSupport(protocolString: string): boolean {
    return this.protocols.has(protocolString);
  }

  /**
   * Abort all protocols
   */
  async abort() {
    await ignoreError(
      Promise.all(
        Array.from(this.protocols.values()).map(({ handler, stream }) => {
          handler.abort();
          return stream.abort();
        })
      )
    );
    this.protocols.clear();
    this.connection = undefined;
  }

  /**
   * Install protocol for remote peer
   * @param protocol - Protocol object
   * @param connection - `libp2p` connection
   * @param libp2pStream - `libp2p` stream
   * @returns Whether the handshake was successful and handler instance
   */
  async installProtocol(protocol: Protocol, connection: Connection, libp2pStream: Stream): Promise<{ success: boolean; handler: ProtocolHandler | null }> {
    const stream = new ProtocolStream(this, protocol.protocolString);
    const handler = await protocol.makeHandler(this, stream);
    if (!handler) {
      return { success: false, handler };
    }
    // close old handler and stream
    const old = this.protocols.get(protocol.protocolString);
    if (old) {
      old.handler.abort();
      await old.stream.abort();
      this.protocols.delete(protocol.protocolString);
    }
    // close old connection
    if (this.connection !== connection) {
      this.connection && this.connection.close();
      this.connection = connection;
    }
    // connect stream with handler
    stream.connectHandler(handler);
    // pipe new stream
    stream.pipeStream(libp2pStream);
    // handshake
    let handshakeResult: undefined | boolean;
    try {
      handshakeResult = await handler.handshake();
      if (!handshakeResult) {
        throw new Error(`protocol ${protocol.protocolString}, handshake failed`);
      }
      this.protocols.set(protocol.protocolString, { handler, stream });
      return { success: true, handler };
    } catch (err) {
      if (handshakeResult === undefined) {
        logger.warn('Peer::installProtocol, handshake failed with remote peer:', this.peerId, 'err:', err);
      }
      handler.abort();
      await stream.abort();
      return { success: false, handler: null };
    }
  }

  /**
   * Uninstall protocol
   * @param protocolString - Protocol string
   * @returns If succeed, return true
   */
  async uninstallProtocol(protocolString: string) {
    const old = this.protocols.get(protocolString);
    if (old) {
      old.handler.abort();
      await old.stream.abort();
      this.protocols.delete(protocolString);
      return true;
    }
    return false;
  }
}
