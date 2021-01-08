import { bufferToInt, rlp } from 'ethereumjs-util';

import { constants } from '@gxchain2/common';
import { BlockHeader, BlockHeaderBuffer, TransactionsBuffer } from '@gxchain2/block';
import { Transaction } from '@gxchain2/tx';

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
    encode: ({ start, count }: { start: number; count: number }) => rlp.encode([1, [start, count]]),
    decode: ([start, count]: Buffer[]) => {
      return { start: bufferToInt(start), count: bufferToInt(count) };
    },
    async process(node: INode, { start, count }: { start: number; count: number }): Promise<[string, BlockHeader[]]> {
      const blocks = await node.blockchain.getBlocks(start, count, 0, false);
      return ['BlockHeaders', blocks.map((b) => b.header)];
    }
  },
  {
    name: 'BlockHeaders',
    code: 2,
    encode: (headers: BlockHeader[]) => rlp.encode([2, headers.map((h) => h.raw())]),
    decode: (headers: BlockHeaderBuffer[]) => headers.map((h) => BlockHeader.fromValuesArray(h))
  },
  {
    name: 'GetBlockBodies',
    code: 3,
    response: 4,
    encode: (headers: BlockHeader[]) => rlp.encode([3, headers.map((h) => h.hash())]),
    decode: (headerHashs: Buffer[]) => headerHashs,
    /*
    decode: (bodies: BlockBodyBuffer[]): Transaction[][] =>
      bodies.map((b) => {
        const txsBuffer = b[0];
        return txsBuffer.map((txBuffer) => Transaction.fromValuesArray(txBuffer));
      }),
      */
    async process(node: INode, headerHashs: Buffer[]): Promise<[string, Transaction[][]]> {
      const bodies: Transaction[][] = [];
      for (const hash of headerHashs) {
        try {
          const block = await node.db.getBlock(hash);
          bodies.push(block.transactions);
        } catch (err) {
          if (err.type !== 'NotFoundError') {
            throw err;
          }
        }
      }
      return ['BlockBodies', bodies];
    }
  },
  {
    name: 'BlockBodies',
    code: 4,
    encode: (bodies: Transaction[][]) =>
      rlp.encode([
        4,
        bodies.map((txs) => {
          return txs.map((tx) => tx.raw());
        })
      ]),
    decode: (bodies: TransactionsBuffer[]): Transaction[][] =>
      bodies.map((txs) => {
        return txs.map((tx) => Transaction.fromValuesArray(tx));
      })
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
