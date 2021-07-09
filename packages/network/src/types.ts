import { Peer } from './peer';

/**
 * Base interface for all wire protocols
 */
export interface Protocol {
  name: string;
  protocolString: string;
  makeHandler(peer: Peer): ProtocolHandler;
}

export interface ProtocolHandler {
  handshake(): boolean | Promise<boolean>;
  handle(data: Buffer): Promise<void>;
  encode(method: string | number, data: any): any;
  abort(): void;
}
