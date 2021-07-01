import type { LevelUp } from 'levelup';
import { DBManager, CacheMap } from '@ethereumjs/blockchain/dist/db/manager';
import { DBOp, DBTarget, DatabaseKey, DBOpData } from '@ethereumjs/blockchain/dist/db/operation';
import Cache from '@ethereumjs/blockchain/dist/db/cache';
import { BN, rlp, toBuffer } from 'ethereumjs-util';
import { Block, BlockBodyBuffer, BlockHeader, BlockHeaderBuffer, TypedTransaction, WrappedTransaction, Receipt } from '@gxchain2/structure';
import { Common } from '@gxchain2/common';
import { compressBytes } from '@gxchain2/utils';
const level = require('level-mem');

// constants for txLookup and receipts
const RECEIPTS_PREFIX = Buffer.from('r');
const TX_LOOKUP_PREFIX = Buffer.from('l');
const BLOOM_BITS_PREFIX = Buffer.from('B');
const bufBE8 = (n: BN) => n.toArrayLike(Buffer, 'be', 8);
const receiptsKey = (n: BN, hash: Buffer) => Buffer.concat([RECEIPTS_PREFIX, bufBE8(n), hash]);
const txLookupKey = (hash: Buffer) => Buffer.concat([TX_LOOKUP_PREFIX, hash]);
const bloomBitsKey = (bit: number, section: BN, hash: Buffer) => {
  const buf = Buffer.alloc(10);
  buf.writeUInt16BE(bit);
  buf.writeBigUInt64BE(BigInt(section.toString()), 2);
  return Buffer.concat([BLOOM_BITS_PREFIX, buf, hash]);
};

// helpers for txLookup and receipts.
const DBTarget_Receipts = 100;
const DBTarget_TxLookup = 101;
const DBTarget_BloomBits = 102;

// TODO: improve types.
function new_DBOp(operationTarget: DBTarget, key?: DatabaseKey): DBOp {
  let cacheString: string;
  let baseDBOpKey: Buffer;
  if (operationTarget === DBTarget_Receipts) {
    cacheString = 'receipts';
    baseDBOpKey = receiptsKey(key!.blockNumber!, key!.blockHash!);
  } else if (operationTarget === DBTarget_TxLookup) {
    cacheString = 'txLookup';
    baseDBOpKey = txLookupKey((key! as any).txHash!);
  } else {
    const anyKey = key! as any;
    cacheString = 'bloomBits';
    baseDBOpKey = bloomBitsKey(anyKey.bit, anyKey.section, anyKey.hash);
  }

  const op: {
    operationTarget: DBTarget;
    baseDBOp: DBOpData;
    cacheString: string;
    updateCache(cacheMap: CacheMap): void;
  } = {
    operationTarget,
    cacheString,
    baseDBOp: {
      key: baseDBOpKey,
      keyEncoding: 'binary',
      valueEncoding: 'binary'
    },
    updateCache(cacheMap: CacheMap) {
      if (op.cacheString && cacheMap[op.cacheString] && Buffer.isBuffer(op.baseDBOp.value)) {
        if (op.baseDBOp.type == 'put') {
          cacheMap[op.cacheString].set(op.baseDBOp.key, op.baseDBOp.value);
        } else if (op.baseDBOp.type == 'del') {
          cacheMap[op.cacheString].del(op.baseDBOp.key);
        } else {
          throw new Error('unsupported db operation on cache');
        }
      }
    }
  };
  return op;
}

export function DBOp_get(operationTarget: DBTarget, key?: DatabaseKey): DBOp {
  if (operationTarget !== DBTarget_Receipts && operationTarget !== DBTarget_TxLookup && operationTarget !== DBTarget_BloomBits) {
    return DBOp.get(operationTarget, key);
  } else {
    return new_DBOp(operationTarget, key);
  }
}

export function DBOp_set(operationTarget: DBTarget, value: Buffer | object, key?: DatabaseKey): DBOp {
  if (operationTarget !== DBTarget_Receipts && operationTarget !== DBTarget_TxLookup && operationTarget !== DBTarget_BloomBits) {
    return DBOp.set(operationTarget, value, key);
  } else {
    const dbOperation = new_DBOp(operationTarget, key);
    dbOperation.baseDBOp.type = 'put';
    if (operationTarget == DBTarget_BloomBits) {
      dbOperation.baseDBOp.value = compressBytes(value as Buffer);
    } else {
      dbOperation.baseDBOp.value = value;
    }
    if (operationTarget == DBTarget.Heads) {
      dbOperation.baseDBOp.valueEncoding = 'json';
    } else {
      dbOperation.baseDBOp.valueEncoding = 'binary';
    }

    return dbOperation;
  }
}

export function DBOp_del(operationTarget: DBTarget, key?: DatabaseKey): DBOp {
  if (operationTarget !== DBTarget_Receipts && operationTarget !== DBTarget_TxLookup && operationTarget !== DBTarget_BloomBits) {
    return DBOp.del(operationTarget, key);
  } else {
    const dbOperation = new_DBOp(operationTarget, key);
    dbOperation.baseDBOp.type = 'del';
    return dbOperation;
  }
}

export function DBSaveTxLookup(block: Block): DBOp[] {
  const dbOps: DBOp[] = [];
  const blockNumber = block.header.number;

  for (const tx of block.transactions) {
    dbOps.push(
      DBOp_set(DBTarget_TxLookup, toBuffer(blockNumber), {
        txHash: tx.hash()
      } as any)
    );
  }

  return dbOps;
}

export function DBSaveReceipts(receipts: Receipt[], blockHash: Buffer, blockNumber: BN) {
  return DBOp_set(DBTarget_Receipts, rlp.encode(receipts.map((r) => r.raw())), {
    blockHash,
    blockNumber
  });
}

export function DBSaveBloomBits(bit: number, section: BN, hash: Buffer, bits: Buffer) {
  return DBOp_set(DBTarget_BloomBits, bits, { bit, section, hash } as any);
}

export class Database extends DBManager {
  constructor(db: LevelUp, common: Common) {
    super(db, common);
    const self: any = this;
    self._cache = Object.assign(self._cache, {
      receipts: new Cache({ max: 256 }),
      txLookup: new Cache({ max: 512 }),
      bloomBits: new Cache({ max: 512 })
    });
  }

  get rawdb(): LevelUp {
    return (this as any)._db;
  }

  async get(dbOperationTarget: DBTarget, key?: DatabaseKey): Promise<any> {
    const dbGetOperation = DBOp_get(dbOperationTarget, key);

    const cacheString = dbGetOperation.cacheString;
    const dbKey = dbGetOperation.baseDBOp.key;
    const dbOpts = dbGetOperation.baseDBOp;

    const self: any = this;
    if (cacheString) {
      if (!self._cache[cacheString]) {
        throw new Error(`Invalid cache: ${cacheString}`);
      }

      let value = self._cache[cacheString].get(dbKey);
      if (!value) {
        value = <Buffer>await self._db.get(dbKey, dbOpts);
        self._cache[cacheString].set(dbKey, value);
      }

      return value;
    }

    return self._db.get(dbKey, dbOpts);
  }

  async getTransaction(txHash: Buffer): Promise<TypedTransaction> {
    const blockHeightBuffer = await this.get(DBTarget_TxLookup, { txHash } as any);
    const blockHeihgt = new BN(blockHeightBuffer);
    const block = await this.getBlock(blockHeihgt);
    for (let i = 0; i < block.transactions.length; i++) {
      const tx = block.transactions[i];
      if (tx.hash().equals(txHash)) {
        return tx;
      }
    }
    throw new level.errors.NotFoundError();
  }

  async getWrappedTransaction(txHash: Buffer): Promise<WrappedTransaction> {
    const blockHeightBuffer = await this.get(DBTarget_TxLookup, { txHash } as any);
    const blockHeihgt = new BN(blockHeightBuffer);
    const block = await this.getBlock(blockHeihgt);
    for (let i = 0; i < block.transactions.length; i++) {
      const tx = block.transactions[i];
      if (tx.hash().equals(txHash)) {
        return new WrappedTransaction(tx).installProperties(block, i);
      }
    }
    throw new level.errors.NotFoundError();
  }

  async getReceipt(txHash: Buffer): Promise<Receipt> {
    const blockHeightBuffer = await this.get(DBTarget_TxLookup, { txHash } as any);
    const blockHeihgt = new BN(blockHeightBuffer);
    const block = await this.getBlock(blockHeihgt);
    const rawArr: Buffer[][] = rlp.decode(await this.get(DBTarget_Receipts, { blockHash: block.hash(), blockNumber: blockHeihgt })) as any;
    let lastCumulativeGasUsed = new BN(0);
    for (let i = 0; i < block.transactions.length; i++) {
      const tx = block.transactions[i];
      const raw = rawArr[i];
      const receipt = Receipt.fromValuesArray(raw);
      if (tx.hash().equals(txHash)) {
        const gasUsed = receipt.bnCumulativeGasUsed.sub(lastCumulativeGasUsed);
        receipt.installProperties(block, tx, gasUsed, i);
        return receipt;
      }
      lastCumulativeGasUsed = receipt.bnCumulativeGasUsed;
    }
    throw new level.errors.NotFoundError();
  }

  async getReceiptByHashAndNumber(txHash: Buffer, blockHash: Buffer, blockNumber: BN): Promise<Receipt> {
    const header: BlockHeaderBuffer = rlp.decode(await this.get(DBTarget.Header, { blockHash, blockNumber })) as any;
    const body = await this.getBody(blockHash, blockNumber);
    const block = Block.fromValuesArray([header, ...body], { common: (this as any)._common, hardforkByBlockNumber: true });
    const rawArr: Buffer[][] = rlp.decode(await this.get(DBTarget_Receipts, { blockHash, blockNumber })) as any;
    let lastCumulativeGasUsed = new BN(0);
    for (let i = 0; i < block.transactions.length; i++) {
      const tx = block.transactions[i];
      const raw = rawArr[i];
      const receipt = Receipt.fromValuesArray(raw);
      if (tx.hash().equals(txHash)) {
        const gasUsed = receipt.bnCumulativeGasUsed.sub(lastCumulativeGasUsed);
        receipt.installProperties(block, tx, gasUsed, i);
        return receipt;
      }
      lastCumulativeGasUsed = receipt.bnCumulativeGasUsed;
    }
    throw new level.errors.NotFoundError();
  }

  async getBlockByHashAndNumber(blockHash: Buffer, blockNumber: BN): Promise<Block> {
    const header: BlockHeaderBuffer = rlp.decode(await this.get(DBTarget.Header, { blockHash, blockNumber })) as any;
    let body: BlockBodyBuffer = [[], []];
    try {
      body = await this.getBody(blockHash, blockNumber);
    } catch (err) {
      if (err.type !== 'NotFoundError') {
        throw err;
      }
    }
    return Block.fromValuesArray([header, ...body], { common: (this as any)._common, hardforkByBlockNumber: true });
  }

  getBloomBits(bit: number, section: BN, hash: Buffer) {
    return this.get(DBTarget_BloomBits, { bit, section, hash } as any);
  }

  async tryToGetCanonicalHeader(hash: Buffer) {
    try {
      const num = await this.hashToNumber(hash);
      const hashInDB = await this.numberToHash(num);
      return hashInDB.equals(hash) ? await this.getHeader(hash, num) : undefined;
    } catch (err) {
      if (err.type === 'NotFoundError') {
        return;
      }
      throw err;
    }
  }

  async getCanonicalHeader(num: BN) {
    const hash = await this.numberToHash(num);
    return await this.getHeader(hash, num);
  }

  async findCommonAncestor(header1: BlockHeader, header2: BlockHeader) {
    while (header1.number.gt(header2.number)) {
      header1 = await this.getHeader(header1.parentHash, header1.number.subn(1));
    }
    while (header2.number.gt(header1.number)) {
      header2 = await this.getHeader(header2.parentHash, header2.number.subn(1));
    }
    while (!header1.hash().equals(header2.hash()) && header1.number.gtn(0) && header2.number.gtn(0)) {
      header1 = await this.getHeader(header1.parentHash, header1.number.subn(1));
      header2 = await this.getHeader(header2.parentHash, header2.number.subn(1));
    }
    if (!header1.hash().equals(header2.hash())) {
      throw new Error('find common ancestor failed');
    }
    return header1;
  }

  // async clearBloomBits(from: BN) {
  //   const db: LevelUp = (this as any)._db;
  //   for (let i = 0; i < constants.BloomBitLength; i++) {
  //     await new Promise<void>((resolve, reject) => {
  //       db.clear(
  //         {
  //           gte: bloomBitsKey(i, from, Buffer.alloc(32, 0)),
  //           lte: bloomBitsKey(i, new BN('ffffffffffffffff', 'hex'), Buffer.alloc(32, 0xff))
  //         },
  //         (err?: Error) => {
  //           if (err) {
  //             reject(err);
  //           } else {
  //             resolve();
  //           }
  //         }
  //       );
  //     });
  //   }
  // }

  async getStoredSectionCount() {
    try {
      return new BN(await this.rawdb.get('scount'));
    } catch (err) {
      if (err.type === 'NotFoundError') {
        return undefined;
      }
      throw err;
    }
  }

  async setStoredSectionCount(section: BN | undefined) {
    section === undefined ? await this.rawdb.del('scount') : await this.rawdb.put('scount', section.toString());
  }
}

import levelUp from 'levelup';
import levelDown from 'leveldown';
import encoding from 'encoding-down';

export const createLevelDB = (path: string) => {
  return levelUp(encoding(levelDown(path)));
};

export { DBTarget, DBOp };
export * from '@ethereumjs/blockchain/dist/db/helpers';