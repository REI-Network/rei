import type EventEmitter from 'events';
import type PeerId from 'peer-id';
import type Multiaddr from 'multiaddr';
import type { ENR } from '@gxchain2/discv5';
import type { Message } from '@gxchain2/discv5/lib/message';
import type { Peer, ProtocolStream } from './peer';

// TODO: add some comments
export interface Protocol {
  get protocolString(): string;
  makeHandler(peer: Peer, stream: ProtocolStream): Promise<ProtocolHandler | null>;
}

// TODO: add some comments
export interface ProtocolHandler {
  handshake(): boolean | Promise<boolean>;
  handle(data: Buffer): void | Promise<void>;
  abort(): void;
}

export type Connection = {
  remotePeer: PeerId;
  close(): void;
  newStream(protocols: string | string[]): Promise<{ stream: Stream }>;
};

export type Stream = {
  close(): void;
  sink(source: AsyncGenerator<Buffer>): Promise<void>;
  source(): AsyncGenerator<{ _bufs: Buffer[] }>;
};

export interface ILibp2p extends EventEmitter {
  on(event: 'discovery', listener: (peerId: PeerId) => void): this;
  on(event: 'connect', listener: (connection: Connection) => void): this;
  on(event: 'disconnect', listener: (connection: Connection) => void): this;

  off(event: 'discovery', listener: (peerId: PeerId) => void): this;
  off(event: 'connect', listener: (connection: Connection) => void): this;
  off(event: 'disconnect', listener: (connection: Connection) => void): this;

  get peerId(): PeerId;
  get maxConnections(): number;
  get connectionSize(): number;

  handle(protocols: string | string[], callback: (input: { connection: Connection; stream: Stream }) => void): void;
  unhandle(protocols: string | string[]): void;

  addAddress(peerId: PeerId, addresses: Multiaddr[]): void;
  getAddress(peerId: PeerId): Multiaddr[] | undefined;

  dial(peer: PeerId | Multiaddr | string): Promise<Connection>;
  hangUp(peerId: PeerId | string): Promise<void>;

  setPeerValue(peerId: PeerId | string, value: number): void;
  setAnnounce(addresses: Multiaddr[]): void;

  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface IDiscv5 extends EventEmitter {
  on(event: 'message', listener: (srcId: string, src: Multiaddr, message: Message) => void): this;
  on(event: 'multiaddrUpdated', listener: () => void): this;

  off(event: 'message', listener: (srcId: string, src: Multiaddr, message: Message) => void): this;
  off(event: 'multiaddrUpdated', listener: () => void): this;

  get localEnr(): ENR;

  addEnr(enr: string | ENR): void;
  findEnr(nodeId: string): ENR | undefined;

  start(): void;
  stop(): void;
}
