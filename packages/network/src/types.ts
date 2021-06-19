export interface Protocol {
  name: string;
  protocolString: string;
  makeHandler(): ProtocolHandler;
}

export interface ProtocolHandler {
  handshake(): boolean | Promise<boolean>;
  handle(data: Buffer): Promise<void>;
  waiting(method: string | number, data: any, resolve: (resps: any) => void, reject: (reason?: any) => void);
  encode(method: string | number, data: any): any;
  abort(): Promise<void>;
}
