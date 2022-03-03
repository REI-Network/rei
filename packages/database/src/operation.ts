import { BN } from 'ethereumjs-util';
import { compressBytes } from '@rei-network/utils';
import { HEADS_KEY, HEAD_HEADER_KEY, HEAD_BLOCK_KEY, BLOOM_BITS_SECTION_COUNT, tdKey, headerKey, bodyKey, numberToHashKey, hashToNumberKey, CLIQUE_SIGNERS_KEY as CLIQUE_SIGNER_STATES_KEY, CLIQUE_VOTES_KEY, CLIQUE_BLOCK_SIGNERS_KEY, receiptsKey, txLookupKey, bloomBitsKey, snapAccountKey, snapStorageKey } from './constants';
import { CacheMap } from './manager';

export enum DBTarget {
  Heads,
  HeadHeader,
  HeadBlock,
  HashToNumber,
  NumberToHash,
  TotalDifficulty,
  Body,
  Header,
  CliqueSignerStates,
  CliqueVotes,
  CliqueBlockSigners,

  Receipts = 100,
  TxLookup = 101,
  BloomBits = 102,
  BloomBitsSectionCount = 103,
  SnapAccount = 104,
  SnapStorage = 105
}

/**
 * DBOpData is a type which has the purpose of holding the actual data of the Database Operation.
 * @hidden
 */
export interface DBOpData {
  type?: String;
  key: Buffer | string;
  keyEncoding: String;
  valueEncoding?: String;
  value?: string | Buffer | object;
}

// a Database Key is identified by a block hash, a block number, or both
export type DatabaseKey = {
  blockNumber?: BN;
  blockHash?: Buffer;
  txHash?: Buffer;
  bit?: number;
  section?: BN;
  hash?: Buffer;
  accountHash?: Buffer;
  storageHash?: Buffer;
};

/**
 * The DBOp class aids creating database operations which is used by `level` using a more high-level interface
 */
export class DBOp {
  public operationTarget: DBTarget;
  public baseDBOp: DBOpData;
  public cacheString: string | undefined;

  private constructor(operationTarget: DBTarget, key?: DatabaseKey) {
    this.operationTarget = operationTarget;

    this.baseDBOp = {
      key: '',
      keyEncoding: 'binary',
      valueEncoding: 'binary'
    };

    switch (operationTarget) {
      case DBTarget.Heads: {
        this.baseDBOp.key = HEADS_KEY;
        this.baseDBOp.valueEncoding = 'json';
        break;
      }
      case DBTarget.HeadHeader: {
        this.baseDBOp.key = HEAD_HEADER_KEY;
        break;
      }
      case DBTarget.HeadBlock: {
        this.baseDBOp.key = HEAD_BLOCK_KEY;
        break;
      }
      case DBTarget.HashToNumber: {
        this.baseDBOp.key = hashToNumberKey(key!.blockHash!);
        this.cacheString = 'hashToNumber';
        break;
      }
      case DBTarget.NumberToHash: {
        this.baseDBOp.key = numberToHashKey(key!.blockNumber!);
        this.cacheString = 'numberToHash';
        break;
      }
      case DBTarget.TotalDifficulty: {
        this.baseDBOp.key = tdKey(key!.blockNumber!, key!.blockHash!);
        this.cacheString = 'td';
        break;
      }
      case DBTarget.Body: {
        this.baseDBOp.key = bodyKey(key!.blockNumber!, key!.blockHash!);
        this.cacheString = 'body';
        break;
      }
      case DBTarget.Header: {
        this.baseDBOp.key = headerKey(key!.blockNumber!, key!.blockHash!);
        this.cacheString = 'header';
        break;
      }
      case DBTarget.CliqueSignerStates: {
        this.baseDBOp.key = CLIQUE_SIGNER_STATES_KEY;
        break;
      }
      case DBTarget.CliqueVotes: {
        this.baseDBOp.key = CLIQUE_VOTES_KEY;
        break;
      }
      case DBTarget.CliqueBlockSigners: {
        this.baseDBOp.key = CLIQUE_BLOCK_SIGNERS_KEY;
        break;
      }
      case DBTarget.Receipts: {
        this.baseDBOp.key = receiptsKey(key!.blockNumber!, key!.blockHash!);
        this.cacheString = 'receipts';
        break;
      }
      case DBTarget.TxLookup: {
        this.baseDBOp.key = txLookupKey(key!.txHash!);
        this.cacheString = 'txLookup';
        break;
      }
      case DBTarget.BloomBits: {
        this.baseDBOp.key = bloomBitsKey(key!.bit!, key!.section!, key!.hash!);
        break;
      }
      case DBTarget.BloomBitsSectionCount: {
        this.baseDBOp.key = BLOOM_BITS_SECTION_COUNT;
        this.baseDBOp.keyEncoding = 'none';
        this.baseDBOp.valueEncoding = 'none';
        break;
      }
      case DBTarget.SnapAccount: {
        this.baseDBOp.key = snapAccountKey(key!.accountHash!);
        this.cacheString = 'snapAccount';
        break;
      }
      case DBTarget.SnapStorage: {
        this.baseDBOp.key = snapStorageKey(key!.accountHash!, key!.storageHash!);
        this.cacheString = 'snapStorage';
        break;
      }
    }
  }

  public static get(operationTarget: DBTarget, key?: DatabaseKey): DBOp {
    return new DBOp(operationTarget, key);
  }

  // set operation: note: value/key is not in default order
  public static set(operationTarget: DBTarget, value: string | Buffer | object, key?: DatabaseKey): DBOp {
    const dbOperation = new DBOp(operationTarget, key);
    dbOperation.baseDBOp.type = 'put';

    if (operationTarget == DBTarget.BloomBits) {
      dbOperation.baseDBOp.value = compressBytes(value as Buffer);
    } else {
      dbOperation.baseDBOp.value = value;
    }

    return dbOperation;
  }

  public static del(operationTarget: DBTarget, key?: DatabaseKey): DBOp {
    const dbOperation = new DBOp(operationTarget, key);
    dbOperation.baseDBOp.type = 'del';
    return dbOperation;
  }

  public updateCache(cacheMap: CacheMap) {
    if (this.cacheString && cacheMap[this.cacheString] && Buffer.isBuffer(this.baseDBOp.value)) {
      if (this.baseDBOp.type == 'put') {
        cacheMap[this.cacheString].set(this.baseDBOp.key, this.baseDBOp.value);
      } else if (this.baseDBOp.type == 'del') {
        cacheMap[this.cacheString].del(this.baseDBOp.key);
      } else {
        throw new Error('unsupported db operation on cache');
      }
    }
  }
}
