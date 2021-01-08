import { bufferToInt, rlp } from 'ethereumjs-util';

import { constants } from '@gxchain2/common';
import { BlockHeader, BlockHeaderBuffer } from '@gxchain2/block';

import { Protocol, Handler } from './protocol';
import type { INode } from '../p2p';

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
    name: 'GetBlockHeaders',
    code: 1,
    response: 2,
    encode: (data) => {
      return rlp.encode([1, [data.start, data.count]]);
    },
    decode: ([start, count]: Buffer[]) => {
      return { start: bufferToInt(start), count: bufferToInt(count) };
    },
    async process(node: INode, { start, count }: { start: number; count: number }): Promise<[string, any]> {
      const blocks = await node.blockchain.getBlocks(start, count, 0, false);
      return ['BlockHeaders', blocks.map((b) => b.header)];
    }
  },
  {
    name: 'BlockHeaders',
    code: 2,
    encode: (headers: BlockHeader[]) => rlp.encode([2, headers.map((h) => h.raw())]),
    decode: (headers: BlockHeaderBuffer[]) => headers.map((h) => BlockHeader.fromValuesArray(h, {}))
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

  handle(data: Buffer): { code: number; handler: Handler; payload: any } {
    let [code, payload]: any = rlp.decode(data);
    code = bufferToInt(code);
    const handler = this.findHandler(code);
    return { code, handler, payload };
  }

  encode(key: string | number, data: any): any {
    return this.findHandler(key).encode(data);
  }

  decode(key: string | number, data: any): any {
    return this.findHandler(key).decode(data);
  }
}
