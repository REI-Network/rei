import EventEmitter from 'events';
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
        await this.peer.uninstallProtocol(this.protocolString);
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
      this.peer.uninstalledHook(this.protocolString);
    }
  }
}

/**
 * Peer class manages a single remote peer instance
 */
export class Peer extends EventEmitter {
  readonly peerId: string;
  readonly createAt: number;
  private readonly protocols = new Map<
    string,
    {
      handler: ProtocolHandler;
      stream: ProtocolStream;
      connection: Connection;
    }
  >();

  constructor(peerId: string, createAt: number = Date.now()) {
    super();
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
   * Get supported protocols
   */
  get supportedProtocols() {
    return Array.from(this.protocols.keys());
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
   * A hook for emiting installed event
   * @param protocolString - Protocol string
   */
  installedHook(protocolString: string) {
    this.emit('installed', this.protocols.get(protocolString)!.handler);
  }

  /**
   * A hook for emiting uninstalled event
   * @param protocolString - Protocol string
   */
  uninstalledHook(protocolString: string) {
    this.emit('uninstalled', protocolString);
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
      if (old.connection !== connection && old.connection._getStreams().length === 0) {
        // disconnect the old connection if no protocol exists
        await old.connection.close();
      }
      this.protocols.delete(protocol.protocolString);
    }
    // connect stream with handler
    stream.connectHandler(handler);
    // pipe new stream
    stream.pipeStream(libp2pStream);
    // handshake
    try {
      if (!(await handler.handshake())) {
        throw new Error(`protocol ${protocol.protocolString}, handshake failed`);
      }
      this.protocols.set(protocol.protocolString, { handler, stream, connection });
      this.installedHook(protocol.protocolString);
      return { success: true, handler };
    } catch (err) {
      logger.warn('Peer::installProtocol, handshake failed with remote peer:', this.peerId, 'err:', err);
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

  /**
   * Get handler by protocol string
   * @param protocolString
   * @returns Handler object
   */
  getHandler(protocolString: string) {
    const val = this.protocols.get(protocolString);
    if (!val) {
      throw new Error('unknown protocol string: ' + protocolString);
    }
    return val.handler;
  }
}
