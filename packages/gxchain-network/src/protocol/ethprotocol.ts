import { Protocol, Handler } from './protocol';

const handlers: Handler[] = [
  {
    name: 'Hellow',
    code: 0,
    encode: () => '',
    decode: () => ''
  }
];

export class ETHProtocol extends Protocol {
  get name() {
    return 'gxc2-ethwire';
  }

  get protocolString(): string {
    return `/${this.name}/1`;
  }

  copy(): Protocol {
    return new ETHProtocol();
  }

  findHandler(key: string | number): Handler {
    const handler = handlers.find((value) => (typeof key === 'string' ? value.name === key : value.code === key));
    if (!handler) {
      throw new Error(`Unkonw handler: ${key}`);
    }
    return handler;
  }

  encode(key: string | number, data: any): any {
    return this.findHandler(key).encode(data);
  }

  decode(key: string | number, data: any): any {
    return this.findHandler(key).decode(data);
  }

  encodeStatus(data: any): any {
    return this.findHandler(0).encode(data);
  }

  decodeStatus(data: any): any {
    return this.findHandler(0).decode(data);
  }
}
