import { bufferToInt, rlp } from 'ethereumjs-util';

import { constants } from '@gxchain2/common';
import { Block, BlockHeader, BlockHeaderBuffer, TransactionsBuffer } from '@gxchain2/block';
import { Transaction } from '@gxchain2/tx';

import { Protocol, Handler, MessageInfo } from './protocol';

const handlers: Handler[] = [
  {
    name: 'Status',
    code: 0,
    encode: (info: MessageInfo, data) => {
      const payload: any = Object.entries(data).map(([k, v]) => [k, v]);
      return rlp.encode([0, payload]);
    },
    decode: (info: MessageInfo, data) => {
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
    encode: (info: MessageInfo, { start, count }: { start: number; count: number }) => rlp.encode([1, [start, count]]),
    decode: (info: MessageInfo, [start, count]: Buffer[]) => {
      return { start: bufferToInt(start), count: bufferToInt(count) };
    },
    async process(info: MessageInfo, { start, count }: { start: number; count: number }): Promise<[string, BlockHeader[]]> {
      const blocks = await info.node.blockchain.getBlocks(start, count, 0, false);
      return ['BlockHeaders', blocks.map((b) => b.header)];
    }
  },
  {
    name: 'BlockHeaders',
    code: 2,
    encode: (info: MessageInfo, headers: BlockHeader[]) => rlp.encode([2, headers.map((h) => h.raw())]),
    decode: (info: MessageInfo, headers: BlockHeaderBuffer[]) => headers.map((h) => BlockHeader.fromValuesArray(h, { common: info.node.common }))
  },
  {
    name: 'GetBlockBodies',
    code: 3,
    response: 4,
    encode: (info: MessageInfo, headers: BlockHeader[]) => rlp.encode([3, headers.map((h) => h.hash())]),
    decode: (info: MessageInfo, headerHashs: Buffer[]) => headerHashs,
    async process(info: MessageInfo, headerHashs: Buffer[]): Promise<[string, Transaction[][]]> {
      const bodies: Transaction[][] = [];
      for (const hash of headerHashs) {
        try {
          const block = await info.node.db.getBlock(hash);
          bodies.push(block.transactions);
        } catch (err) {
          if (err.type !== 'NotFoundError') {
            throw err;
          }
          bodies.push([]);
        }
      }
      return ['BlockBodies', bodies];
    }
  },
  {
    name: 'BlockBodies',
    code: 4,
    encode: (info: MessageInfo, bodies: Transaction[][]) =>
      rlp.encode([
        4,
        bodies.map((txs) => {
          return txs.map((tx) => tx.raw());
        })
      ]),
    decode: (info: MessageInfo, bodies: TransactionsBuffer[]): Transaction[][] =>
      bodies.map((txs) => {
        return txs.map((tx) => Transaction.fromValuesArray(tx, { common: info.node.common }));
      })
  },
  {
    name: 'NewBlock',
    code: 5,
    encode: (info: MessageInfo, block: Block) => rlp.encode([5, [block.header.raw(), block.transactions.map((tx) => tx.raw())]]),
    decode: (info: MessageInfo, blockRaw): Block => Block.fromValuesArray(blockRaw, { common: info.node.common }),
    process(info: MessageInfo, block: Block) {
      info.node.sync.announce(info.peer, block.header.number.toNumber());
    }
  },
  {
    name: 'NewPooledTransactionHashes',
    code: 6,
    encode: (info: MessageInfo, hashes: Buffer[]) => rlp.encode([6, [...hashes]]),
    decode: (info: MessageInfo, hashes): Buffer[] => hashes,
    process: (info: MessageInfo, hashes: Buffer[]) => {
      info.node.txSync.newPooledTransactionHashes(info.peer.peerId, hashes);
    }
  },
  {
    name: 'GetPooledTransactions',
    code: 7,
    response: 8,
    encode: (info: MessageInfo, hashes: Buffer[]) => rlp.encode([7, [...hashes]]),
    decode: (info: MessageInfo, hashes): Buffer[] => hashes,
    process: (info: MessageInfo, hashes: Buffer[]) => {
      return [
        'PooledTransactions',
        hashes.map((hash) => {
          const wtx = info.node.txPool.getTransaction(hash);
          return wtx ? wtx.transaction : undefined;
        })
      ];
    }
  },
  {
    name: 'PooledTransactions',
    code: 8,
    encode: (info: MessageInfo, txs: Transaction[]) => rlp.encode([8, txs.map((tx) => tx.serialize())]),
    decode: (info: MessageInfo, raws: TransactionsBuffer) => raws.map((raw) => Transaction.fromValuesArray(raw, { common: info.node.common }))
  },
  {
    name: 'Echo',
    code: 111,
    encode: (info: MessageInfo, data) => {
      return rlp.encode([111, data]);
    },
    decode: (info: MessageInfo, data) => {
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

  protected isValidRemoteStatus(remoteStatus: any, localStatus: any): boolean {
    return remoteStatus.networkId === localStatus.networkId && Buffer.from(localStatus.genesisHash.substr(2), 'hex').equals(remoteStatus.genesisHash);
  }
}
