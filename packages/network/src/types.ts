import { Peer } from './peer';

export interface Protocol {
  protocolString: string;
  beforeMakeHandler(peer: Peer): boolean | Promise<boolean>;
  makeHandler(peer: Peer): ProtocolHandler;
}

export interface ProtocolHandler {
  handshake(): boolean | Promise<boolean>;
  handle(data: Buffer): void | Promise<void>;
  abort(): void;
}
