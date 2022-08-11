import type EventEmitter from 'events';
import type PeerId from 'peer-id';
import type Multiaddr from 'multiaddr';
import type { ENR } from '@gxchain2/discv5';
import type { Message } from '@gxchain2/discv5/lib/message';
import type { Peer, ProtocolStream } from './peer';

export interface Protocol {
  /**
   * Get a unique string representing this protocol
   */
  get protocolString(): string;

  /**
   * Generate handler instance for this protocol
   * @param peer - Peer instance
   * @param stream - Stream instance
   */
  makeHandler(peer: Peer, stream: ProtocolStream): Promise<ProtocolHandler | null>;
}

export interface ProtocolHandler {
  /**
   * Handshake with the remote peer
   */
  handshake(): boolean | Promise<boolean>;

  /**
   * Handle messages from remote nodes
   * @param data - Message data
   */
  handle(data: Buffer): void | Promise<void>;

  /**
   * Abort handler
   */
  abort(): void;
}

export type Connection = {
  // remote peer id
  remotePeer: PeerId;

  /**
   * Close connection
   */
  close(): Promise<void>;

  /**
   * Create new streams for protocols
   * @param protocols - Protocols
   */
  newStream(protocols: string | string[]): Promise<{ stream: Stream }>;

  /**
   * Get all streams
   */
  _getStreams(): Stream[];
};

export type Stream = {
  /**
   * Close stream
   */
  close(): void;

  /**
   * Accept an async generator to send data to remote peer
   * @param source - Source stream
   */
  sink(source: AsyncGenerator<Buffer>): Promise<void>;

  /**
   * Return an async generator to receive data from remote peer
   */
  source(): AsyncGenerator<{ _bufs: Buffer[] }>;
};

export interface ILibp2p extends EventEmitter {
  on(event: 'discovery', listener: (peerId: PeerId) => void): this;
  on(event: 'connect', listener: (connection: Connection) => void): this;
  on(event: 'disconnect', listener: (connection: Connection) => void): this;

  off(event: 'discovery', listener: (peerId: PeerId) => void): this;
  off(event: 'connect', listener: (connection: Connection) => void): this;
  off(event: 'disconnect', listener: (connection: Connection) => void): this;

  // get local peer id
  get peerId(): PeerId;

  // get all peerIds in address book
  get peers(): string[];

  // get max connection size
  get maxConnections(): number;

  // get current connection size
  get connectionSize(): number;

  /**
   * Register protocols to libp2p
   * @param protocols - Protocols
   * @param callback - A callback that will be called when the protocol is received
   */
  handle(protocols: string | string[], callback: (input: { connection: Connection; stream: Stream }) => void): void;

  /**
   * Unregister protocols
   * @param protocols - Protocols
   */
  unhandle(protocols: string | string[]): void;

  /**
   * Add addresses to address book
   * @param peerId - Peer id
   * @param addresses - Multi addresses
   */
  addAddress(peerId: PeerId, addresses: Multiaddr[]): void;

  /**
   * Load addresses from address book
   * @param peerId - Peer id
   */
  getAddress(peerId: PeerId): Multiaddr[] | undefined;

  /**
   * Remove addresses from address book
   * @param peerId - Peer id
   */
  removeAddress(peerId: PeerId): boolean;

  /**
   * Dial remote peer
   * @param peer - Remote peer id or address
   */
  dial(peer: PeerId | Multiaddr | string): Promise<Connection>;

  /**
   * Disconnect all connections with remote peer
   * @param peerId - Remote peer id or address
   */
  hangUp(peerId: PeerId | string): Promise<void>;

  /**
   * Set peer value
   * @param peerId - Peer id
   * @param value - Peer value
   */
  setPeerValue(peerId: PeerId | string, value: number): void;

  /**
   * Set announcement address,
   * this address will be exchanged after the node handshake is successful
   * @param addresses - Multi addresses
   */
  setAnnounce(addresses: Multiaddr[]): void;

  /**
   * Get all connections under a peer
   * @param peerId - Peer id
   */
  getConnections(peerId: string): Connection[] | undefined;

  /**
   * Start libp2p
   */
  start(): Promise<void>;

  /**
   * Stop libp2p
   */
  stop(): Promise<void>;
}

export interface IDiscv5 extends EventEmitter {
  on(event: 'message', listener: (srcId: string, src: Multiaddr, message: Message) => void): this;
  on(event: 'multiaddrUpdated', listener: () => void): this;

  off(event: 'message', listener: (srcId: string, src: Multiaddr, message: Message) => void): this;
  off(event: 'multiaddrUpdated', listener: () => void): this;

  // Get local enr address
  get localEnr(): ENR;

  /**
   * Add enr to kbucket
   * @param enr - ENR object
   */
  addEnr(enr: string | ENR): void;

  /**
   * Find enr object by node id
   * @param nodeId - Node id
   */
  findEnr(nodeId: string): ENR | undefined;

  /**
   * Start discv5
   */
  start(): void;

  /**
   * Stop discv5
   */
  stop(): void;
}
