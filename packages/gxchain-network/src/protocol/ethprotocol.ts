import { bufferToInt, bufferToHex, rlp, BN } from 'ethereumjs-util';
import { constants } from '@gxchain2/common';
import { TxFromValuesArray, TypedTransaction, Block, BlockHeader, BlockHeaderBuffer, TransactionsBuffer } from '@gxchain2/structure';
import { logger } from '@gxchain2/utils';
import { Protocol, Handler } from './protocol';
import type { MsgContext } from '../peer';

const handlers: Handler[] = [
  {
    name: 'Status',
    code: 0,
    encode: (info: MsgContext, data) => {
      const payload: any = Object.entries(data).map(([k, v]) => [k, v]);
      return rlp.encode([0, payload]);
    },
    decode: (info: MsgContext, data) => {
      const status: any = {};
      data.forEach(([k, v]: any) => {
        status[k.toString()] = v;
      });
      return {
        networkId: bufferToInt(status.networkId),
        totalDifficulty: status.totalDifficulty,
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
    encode: (info: MsgContext, { start, count }: { start: number; count: number }) => rlp.encode([1, [start, count]]),
    decode: (info: MsgContext, [start, count]: Buffer[]) => {
      return { start: bufferToInt(start), count: bufferToInt(count) };
    },
    async process(info: MsgContext, { start, count }: { start: number; count: number }): Promise<[string, BlockHeader[]]> {
      const blocks = await info.node.blockchain.getBlocks(start, count, 0, false);
      return ['BlockHeaders', blocks.map((b) => b.header)];
    }
  },
  {
    name: 'BlockHeaders',
    code: 2,
    encode: (info: MsgContext, headers: BlockHeader[]) => rlp.encode([2, headers.map((h) => h.raw())]),
    decode: (info: MsgContext, headers: BlockHeaderBuffer[]) => headers.map((h) => BlockHeader.fromValuesArray(h, { common: info.node.getCommon(0) }))
  },
  {
    name: 'GetBlockBodies',
    code: 3,
    response: 4,
    encode: (info: MsgContext, headers: BlockHeader[]) => rlp.encode([3, headers.map((h) => h.hash())]),
    decode: (info: MsgContext, headerHashs: Buffer[]) => headerHashs,
    async process(info: MsgContext, headerHashs: Buffer[]): Promise<[string, TypedTransaction[][]]> {
      const bodies: TypedTransaction[][] = [];
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
    encode: (info: MsgContext, bodies: TypedTransaction[][]) =>
      rlp.encode([
        4,
        bodies.map((txs) => {
          return txs.map((tx) => tx.raw());
        })
      ]),
    decode: (info: MsgContext, bodies: TransactionsBuffer[]): TypedTransaction[][] =>
      bodies.map((txs) => {
        return txs.map((tx) => TxFromValuesArray(tx, { common: info.node.getCommon(0) }));
      })
  },
  {
    name: 'NewBlock',
    code: 5,
    encode: (info: MsgContext, { block, td }: { block: Block; td: BN }) => rlp.encode([5, [[block.header.raw(), block.transactions.map((tx) => tx.raw())], td.toBuffer()]]),
    decode: (info: MsgContext, raw): { block: Block; td: BN } => {
      return {
        block: Block.fromValuesArray(raw[0], { common: info.node.getCommon(0), hardforkByBlockNumber: true }),
        td: new BN(raw[1])
      };
    },
    process(info: MsgContext, { block, td }: { block: Block; td: BN }) {
      const height = block.header.number.toNumber();
      const bestHash = bufferToHex(block.hash());
      const totalDifficulty = td.toString();
      info.node.sync.announce(info.peer, height, td);
      if (info.protocol instanceof ETHProtocol) {
        info.protocol.updateStatus(height, bestHash, totalDifficulty);
      }
    }
  },
  {
    name: 'NewPooledTransactionHashes',
    code: 6,
    encode: (info: MsgContext, hashes: Buffer[]) => rlp.encode([6, [...hashes]]),
    decode: (info: MsgContext, hashes): Buffer[] => hashes,
    process: (info: MsgContext, hashes: Buffer[]) => {
      info.node.txSync.newPooledTransactionHashes(info.peer.peerId, hashes);
    }
  },
  {
    name: 'GetPooledTransactions',
    code: 7,
    response: 8,
    encode: (info: MsgContext, hashes: Buffer[]) => rlp.encode([7, [...hashes]]),
    decode: (info: MsgContext, hashes): Buffer[] => hashes,
    process: (info: MsgContext, hashes: Buffer[]) => {
      return ['PooledTransactions', hashes.map((hash) => info.node.txPool.getTransaction(hash)).filter((tx) => tx !== undefined)];
    }
  },
  {
    name: 'PooledTransactions',
    code: 8,
    encode: (info: MsgContext, txs: TypedTransaction[]) => rlp.encode([8, txs.map((tx) => tx.raw())]),
    decode: (info: MsgContext, raws: TransactionsBuffer) => raws.map((raw) => TxFromValuesArray(raw, { common: info.node.getCommon(0) }))
  },
  {
    name: 'Echo',
    code: 111,
    encode: (info: MsgContext, data) => {
      return rlp.encode([111, data]);
    },
    decode: (info: MsgContext, data) => {
      logger.debug('Echo', (data as Buffer).toString());
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
    return remoteStatus.networkId === localStatus.networkId && localStatus.genesisHash.equals(remoteStatus.genesisHash);
  }

  updateStatus(height: number, bestHash: string, totalDifficulty: string) {
    this._status.height = height;
    this._status.bestHash = bestHash;
    this._status.totalDifficulty = totalDifficulty;
  }
}
