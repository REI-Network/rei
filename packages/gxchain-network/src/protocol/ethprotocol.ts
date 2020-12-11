import { bufferToInt, rlp } from 'ethereumjs-util';

import { constants } from '@gxchain2/common';

import { Protocol, Handler } from './protocol';

const handlers: Handler[] = [
  {
    name: 'Status',
    code: 0,
    encode: (data) => {
      const payload: any = Object.entries(data).map(([k, v]) => [k, v]);
      return rlp.encode([0, payload]);
    },
    decode: (data) => {
      const status: any = {};
      data.forEach(([k, v]: any) => {
        status[k.toString()] = v;
      });
      return {
        networkId: bufferToInt(status.networkId),
        height: bufferToInt(status.height),
        bestHash: status.bestHash,
        genesisHash: status.genesisHash
      };
    }
  },
  {
    name: 'Echo',
    code: 111,
    encode: (data) => {
      return rlp.encode([111, data]);
    },
    decode: (data) => {
      console.debug('Echo', (data as Buffer).toString());
      return data;
    }
  }
];

export class ETHProtocol extends Protocol {
  get name() {
    return constants.GXC2_ETHWIRE;
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
