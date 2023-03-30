import { bufferToInt, BN, bnToUnpaddedBuffer } from 'ethereumjs-util';
import { mustParseTransction, Transaction, Block, BlockHeader, BlockHeaderBuffer, TransactionsBuffer } from '@rei-network/structure';
import { NodeStatus } from '../../types';
import { WireProtocolHandler } from './handler';
import * as c from './config';

export type HandlerFunc = {
  name: string;
  code: number;
  response?: number;
  encode(data: any): any;
  decode(data: any): any;
  process?: (data: any) => Promise<[string, any]> | Promise<[string, any] | void> | [string, any] | void;
};

export const wireHandlerBaseFuncs: HandlerFunc[] = [
  {
    name: 'Status',
    code: 0,
    encode(this: WireProtocolHandler, data: NodeStatus) {
      const payload: any = Object.entries(data).map(([k, v]) => [k, v]);
      return payload;
    },
    decode(this: WireProtocolHandler, data): NodeStatus {
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
    },
    process(this: WireProtocolHandler, status: NodeStatus) {
      this.handshakeResponse(status);
    }
  },
  {
    name: 'GetBlockHeaders',
    code: 1,
    response: 2,
    encode(this: WireProtocolHandler, { start, count }: { start: BN; count: BN }) {
      return [bnToUnpaddedBuffer(start), bnToUnpaddedBuffer(count)];
    },
    decode(this: WireProtocolHandler, [start, count]: Buffer[]) {
      return { start: new BN(start), count: new BN(count) };
    },
    async process(this: WireProtocolHandler, { start, count }: { start: BN; count: BN }): Promise<[string, BlockHeader[]] | void> {
      if (count.gtn(c.maxGetBlockHeaders)) {
        this.node.banPeer(this.peer.peerId, 'invalid');
        return;
      }

      const headers: BlockHeader[] = [];
      for (const n = start.clone(); ; n.iaddn(1)) {
        try {
          headers.push(await this.node.db.getCanonicalHeader(n));
        } catch (err) {
          // ignore all errors ...
          break;
        }

        if (headers.length >= count.toNumber()) {
          break;
        }
      }
      return ['BlockHeaders', headers];
    }
  },
  {
    name: 'BlockHeaders',
    code: 2,
    encode(this: WireProtocolHandler, headers: BlockHeader[]) {
      return headers.map((h) => h.raw());
    },
    decode(this: WireProtocolHandler, headers: BlockHeaderBuffer[]) {
      return headers.map((h) => BlockHeader.fromValuesArray(h, { common: this.node.getCommon(0), hardforkByBlockNumber: true }));
    }
  },
  {
    name: 'GetBlockBodies',
    code: 3,
    response: 4,
    encode(this: WireProtocolHandler, headers: BlockHeader[]) {
      return headers.map((h) => h.hash());
    },
    decode(this: WireProtocolHandler, headerHashs: Buffer[]) {
      return headerHashs;
    },
    async process(this: WireProtocolHandler, headerHashs: Buffer[]): Promise<[string, Transaction[][]] | void> {
      if (headerHashs.length > c.maxGetBlockHeaders) {
        this.node.banPeer(this.peer.peerId, 'invalid');
        return;
      }
      const bodies: Transaction[][] = [];
      for (const hash of headerHashs) {
        try {
          const block = await this.node.db.getBlock(hash);
          bodies.push(block.transactions as Transaction[]);
        } catch (err: any) {
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
    encode(this: WireProtocolHandler, bodies: Transaction[][]) {
      return bodies.map((txs) => {
        return txs.map((tx) => tx.raw() as Buffer[]);
      });
    },
    decode(this: WireProtocolHandler, bodies: TransactionsBuffer[]): Transaction[][] {
      return bodies.map((txs) => {
        return txs.map((tx) => mustParseTransction(tx, { common: this.node.getCommon(0) }));
      });
    }
  },
  {
    name: 'NewBlock',
    code: 5,
    encode(this: WireProtocolHandler, { block, td }: { block: Block; td: BN }) {
      return [[block.header.raw(), block.transactions.map((tx) => tx.raw() as Buffer[])], td.toBuffer()];
    },
    decode(this: WireProtocolHandler, raw): { block: Block; td: BN } {
      return {
        block: Block.fromValuesArray(raw[0], { common: this.node.getCommon(0), hardforkByBlockNumber: true }),
        td: new BN(raw[1])
      };
    },
    process(this: WireProtocolHandler, { block, td }: { block: Block; td: BN }) {
      const height = block.header.number.toNumber();
      const bestHash = block.hash();
      this.knowBlocks([bestHash]);
      const totalDifficulty = td.toBuffer();
      this.updateStatus({ height, bestHash, totalDifficulty });
      this.node.sync.announceNewBlock(this, block);
    }
  },
  {
    name: 'NewPooledTransactionHashes',
    code: 6,
    encode(this: WireProtocolHandler, hashes: Buffer[]) {
      return [...hashes];
    },
    decode(this: WireProtocolHandler, hashes): Buffer[] {
      return hashes;
    },
    process(this: WireProtocolHandler, hashes: Buffer[]) {
      if (hashes.length > c.maxTxPacketSize) {
        this.node.banPeer(this.peer.peerId, 'invalid');
        return;
      }
      this.knowTxs(hashes);
      this.node.txSync.newPooledTransactionHashes(this.peer.peerId, hashes);
    }
  },
  {
    name: 'GetPooledTransactions',
    code: 7,
    response: 8,
    encode(this: WireProtocolHandler, hashes: Buffer[]) {
      return [...hashes];
    },
    decode(this: WireProtocolHandler, hashes): Buffer[] {
      return hashes;
    },
    process(this: WireProtocolHandler, hashes: Buffer[]) {
      if (hashes.length > c.maxTxRetrievals) {
        this.node.banPeer(this.peer.peerId, 'invalid');
        return;
      }
      return ['PooledTransactions', hashes.map((hash) => this.node.txPool.getTransaction(hash)).filter((tx) => tx !== undefined)];
    }
  },
  {
    name: 'PooledTransactions',
    code: 8,
    encode(this: WireProtocolHandler, txs: Transaction[]) {
      return txs.map((tx) => tx.raw() as Buffer[]);
    },
    decode(this: WireProtocolHandler, raws: TransactionsBuffer) {
      return raws.map((raw) => mustParseTransction(raw, { common: this.node.getLatestCommon() }));
    }
  }
];
