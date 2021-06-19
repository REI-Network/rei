import { Peer } from './peer';

export interface Protocol {
  name: string;
  protocolString: string;
  makeHandler(): ProtocolHandler;
}

export interface ProtocolHandler {
  handshake(): boolean | Promise<boolean>;
  handle(data: Buffer, send: (method: string, data: any) => void): Promise<void>;
  encode(method: string | number, data: any): any;
  abort(): Promise<void>;
}
