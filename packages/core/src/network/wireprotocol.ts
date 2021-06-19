import { bufferToInt, bufferToHex, rlp, BN } from 'ethereumjs-util';
import { constants } from '@gxchain2/common';
import { TxFromValuesArray, TypedTransaction, Block, BlockHeader, BlockHeaderBuffer, TransactionsBuffer } from '@gxchain2/structure';
import { logger } from '@gxchain2/utils';
import { Protocol, ProtocolHandler, Peer } from '@gxchain2/network';
import { Node } from '../node';

export type Handler = {
  name: string;
  code: number;
  response?: number;
  encode(data: any): any;
  decode(data: any): any;
  process?: (data: any) => Promise<[string, any]> | [string, any] | void;
};

const wireHandlers: Handler[] = [
  {
    name: 'Status',
    code: 0,
    encode(this: WireProtocolHandler, data) {
      const payload: any = Object.entries(data).map(([k, v]) => [k, v]);
      return rlp.encode([0, payload]);
    },
    decode(this: WireProtocolHandler, data) {
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
    encode(this: WireProtocolHandler, { start, count }: { start: number; count: number }) {
      return rlp.encode([1, [start, count]]);
    },
    decode(this: WireProtocolHandler, [start, count]: Buffer[]) {
      return { start: bufferToInt(start), count: bufferToInt(count) };
    },
    async process(this: WireProtocolHandler, { start, count }: { start: number; count: number }): Promise<[string, BlockHeader[]]> {
      const blocks = await info.node.blockchain.getBlocks(start, count, 0, false);
      return ['BlockHeaders', blocks.map((b) => b.header)];
    }
  },
  {
    name: 'BlockHeaders',
    code: 2,
    encode(this: WireProtocolHandler, headers: BlockHeader[]) {
      return rlp.encode([2, headers.map((h) => h.raw())]);
    },
    decode(this: WireProtocolHandler, headers: BlockHeaderBuffer[]) {
      return headers.map((h) => BlockHeader.fromValuesArray(h, { common: info.node.getCommon(0) }));
    }
  },
  {
    name: 'GetBlockBodies',
    code: 3,
    response: 4,
    encode(this: WireProtocolHandler, headers: BlockHeader[]) {
      return rlp.encode([3, headers.map((h) => h.hash())]);
    },
    decode(this: WireProtocolHandler, headerHashs: Buffer[]) {
      return headerHashs;
    },
    async process(this: WireProtocolHandler, headerHashs: Buffer[]): Promise<[string, TypedTransaction[][]]> {
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
    encode(this: WireProtocolHandler, bodies: TypedTransaction[][]) {
      return rlp.encode([
        4,
        bodies.map((txs) => {
          return txs.map((tx) => tx.raw() as Buffer[]);
        })
      ]);
    },
    decode(this: WireProtocolHandler, bodies: TransactionsBuffer[]): TypedTransaction[][] {
      return bodies.map((txs) => {
        return txs.map((tx) => TxFromValuesArray(tx, { common: info.node.getCommon(0) }));
      });
    }
  },
  {
    name: 'NewBlock',
    code: 5,
    encode(this: WireProtocolHandler, { block, td }: { block: Block; td: BN }) {
      return rlp.encode([5, [[block.header.raw(), block.transactions.map((tx) => tx.raw() as Buffer[])], td.toBuffer()]]);
    },
    decode(this: WireProtocolHandler, raw): { block: Block; td: BN } {
      return {
        block: Block.fromValuesArray(raw[0], { common: info.node.getCommon(0), hardforkByBlockNumber: true }),
        td: new BN(raw[1])
      };
    },
    process(this: WireProtocolHandler, { block, td }: { block: Block; td: BN }) {
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
    encode(this: WireProtocolHandler, hashes: Buffer[]) {
      return rlp.encode([6, [...hashes]]);
    },
    decode(this: WireProtocolHandler, hashes): Buffer[] {
      return hashes;
    },
    process(this: WireProtocolHandler, hashes: Buffer[]) {
      info.node.txSync.newPooledTransactionHashes(info.peer.peerId, hashes);
    }
  },
  {
    name: 'GetPooledTransactions',
    code: 7,
    response: 8,
    encode(this: WireProtocolHandler, hashes: Buffer[]) {
      return rlp.encode([7, [...hashes]]);
    },
    decode(this: WireProtocolHandler, hashes): Buffer[] {
      return hashes;
    },
    process(this: WireProtocolHandler, hashes: Buffer[]) {
      return ['PooledTransactions', hashes.map((hash) => info.node.txPool.getTransaction(hash)).filter((tx) => tx !== undefined)];
    }
  },
  {
    name: 'PooledTransactions',
    code: 8,
    encode(this: WireProtocolHandler, txs: TypedTransaction[]) {
      return rlp.encode([8, txs.map((tx) => tx.raw() as Buffer[])]);
    },
    decode(this: WireProtocolHandler, raws: TransactionsBuffer) {
      return raws.map((raw) => TxFromValuesArray(raw, { common: info.node.getCommon(0) }));
    }
  },
  {
    name: 'Echo',
    code: 111,
    encode(this: WireProtocolHandler, data) {
      return rlp.encode([111, data]);
    },
    decode(this: WireProtocolHandler, data) {
      logger.debug('Echo', (data as Buffer).toString());
      return data;
    }
  }
];

export class WireProtocol implements Protocol {
  get name() {
    return '';
  }

  get protocolString() {
    return '';
  }

  // makeHandler() {}
}

function findHandler(method: string | number) {
  const handler = wireHandlers.find((h) => (typeof method === 'string' ? h.name === method : h.code === method));
  if (!handler) {
    throw new Error(`Missing handler, method: ${method}`);
  }
  return handler;
}

export class WireProtocolHandler implements ProtocolHandler {
  private readonly waitingRequests = new Map<
    number,
    {
      resolve: (data: any) => void;
      reject: (reason?: any) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  encode(method: string | number, data: any) {
    return findHandler(method).encode.call(this, data);
  }

  async handle(data: Buffer, send: (method: string, data: any) => void) {
    const [code, payload]: any = rlp.decode(data);
    const numCode = bufferToInt(code);
    const handler = findHandler(numCode);
    data = handler.decode.call(this, payload);
    if (code === 0) {
      //
    } else {
      const request = this.waitingRequests.get(code);
      if (request) {
        clearTimeout(request.timeout);
        this.waitingRequests.delete(code);
        request.resolve(data);
      } else if (handler.process) {
        const result = handler.process.call(this, data);
        if (result) {
          if (Array.isArray(result)) {
            const [method, resps] = result;
            send(method, resps);
          } else {
            result
              .then(([method, resps]) => {
                send(method, resps);
              })
              .catch((err) => {
                // this.emit('error', err);
              });
          }
        }
      }
    }
  }
}
