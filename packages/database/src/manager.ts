import * as rlp from 'rlp';
import { Address, BN } from 'ethereumjs-util';
import { Block, BlockHeader, BlockBuffer, BlockHeaderBuffer, BlockBodyBuffer, Transaction, Receipt } from '@rei-network/structure';
import { Common } from '@rei-network/common';
import { CliqueLatestSignerStates, CliqueLatestVotes, CliqueLatestBlockSigners } from './clique';
import Cache from './cache';
import { DatabaseKey, DBOp, DBTarget, DBOpData } from './operation';
import type { LevelUp } from 'levelup';
const level = require('level-mem');

/**
 * @hidden
 */
export interface GetOpts {
  keyEncoding?: string;
  valueEncoding?: string;
  cache?: string;
}

export type CacheMap = { [key: string]: Cache<Buffer> };

/**
 * Abstraction over a DB to facilitate storing/fetching blockchain-related
 * data, such as blocks and headers, indices, and the head block.
 * @hidden
 */
export class DBManager {
  private _cache: CacheMap;
  private _common: Common;
  private _db: LevelUp;

  constructor(db: LevelUp, common: Common) {
    this._db = db;
    this._common = common;
    this._cache = {
      td: new Cache({ max: 1024 }),
      header: new Cache({ max: 512 }),
      body: new Cache({ max: 256 }),
      numberToHash: new Cache({ max: 2048 }),
      hashToNumber: new Cache({ max: 2048 }),
      txLookup: new Cache({ max: 2048 }),
      receipts: new Cache({ max: 1024 }),
      snapAccount: new Cache({ max: 1024 }),
      snapStorage: new Cache({ max: 1024 })
    };
  }

  get rawdb(): LevelUp {
    return this._db;
  }

  /**
   * Fetches iterator heads from the db.
   */
  async getHeads(): Promise<{ [key: string]: Buffer }> {
    const heads = await this.get(DBTarget.Heads);
    Object.keys(heads).forEach((key) => {
      heads[key] = Buffer.from(heads[key]);
    });
    return heads;
  }

  /**
   * Fetches header of the head block.
   */
  async getHeadHeader(): Promise<Buffer> {
    return this.get(DBTarget.HeadHeader);
  }

  /**
   * Fetches head block.
   */
  async getHeadBlock(): Promise<Buffer> {
    return this.get(DBTarget.HeadBlock);
  }

  /**
   * Fetches clique signers.
   */
  async getCliqueLatestSignerStates(): Promise<CliqueLatestSignerStates> {
    try {
      const signerStates = await this.get(DBTarget.CliqueSignerStates);
      const states = (<any>rlp.decode(signerStates)) as [Buffer, Buffer[]];
      return states.map((state) => {
        const blockNum = new BN(state[0]);
        const addrs = (<any>state[1]).map((buf: Buffer) => new Address(buf));
        return [blockNum, addrs];
      }) as CliqueLatestSignerStates;
    } catch (error: any) {
      if (error.type === 'NotFoundError') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Fetches clique votes.
   */
  async getCliqueLatestVotes(): Promise<CliqueLatestVotes> {
    try {
      const signerVotes = await this.get(DBTarget.CliqueVotes);
      const votes = (<any>rlp.decode(signerVotes)) as [Buffer, [Buffer, Buffer, Buffer]];
      return votes.map((vote) => {
        const blockNum = new BN(vote[0]);
        const signer = new Address((vote[1] as any)[0]);
        const beneficiary = new Address((vote[1] as any)[1]);
        const nonce = (vote[1] as any)[2];
        return [blockNum, [signer, beneficiary, nonce]];
      }) as CliqueLatestVotes;
    } catch (error: any) {
      if (error.type === 'NotFoundError') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Fetches snapshot of clique signers.
   */
  async getCliqueLatestBlockSigners(): Promise<CliqueLatestBlockSigners> {
    try {
      const blockSigners = await this.get(DBTarget.CliqueBlockSigners);
      const signers = (<any>rlp.decode(blockSigners)) as [Buffer, Buffer][];
      return signers.map((s) => {
        const blockNum = new BN(s[0]);
        const signer = new Address(s[1] as any);
        return [blockNum, signer];
      }) as CliqueLatestBlockSigners;
    } catch (error: any) {
      if (error.type === 'NotFoundError') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Fetches a block (header and body) given a block id,
   * which can be either its hash or its number.
   */
  async getBlock(blockId: Buffer | BN | number): Promise<Block> {
    if (typeof blockId === 'number' && Number.isInteger(blockId)) {
      blockId = new BN(blockId);
    }

    let number;
    let hash;
    if (Buffer.isBuffer(blockId)) {
      hash = blockId;
      number = await this.hashToNumber(blockId);
    } else if (BN.isBN(blockId)) {
      number = blockId;
      hash = await this.numberToHash(blockId);
    } else {
      throw new Error('Unknown blockId type');
    }

    const header: BlockHeaderBuffer = (await this.getHeader(hash, number)).raw();
    let body: BlockBodyBuffer = [[], []];
    try {
      body = await this.getBody(hash, number);
    } catch (error: any) {
      if (error.type !== 'NotFoundError') {
        throw error;
      }
    }
    const blockData = [header, ...body] as BlockBuffer;
    const opts = { common: this._common, hardforkByBlockNumber: true };
    return Block.fromValuesArray(blockData, opts);
  }

  /**
   * Fetches body of a block given its hash and number.
   */
  async getBody(blockHash: Buffer, blockNumber: BN): Promise<BlockBodyBuffer> {
    const body = await this.get(DBTarget.Body, { blockHash, blockNumber });
    return rlp.decode(body) as any as BlockBodyBuffer;
  }

  /**
   * Fetches header of a block given its hash and number.
   */
  async getHeader(blockHash: Buffer, blockNumber: BN) {
    const encodedHeader = await this.get(DBTarget.Header, { blockHash, blockNumber });
    const opts = { common: this._common, hardforkByBlockNumber: true };
    return BlockHeader.fromRLPSerializedHeader(encodedHeader, opts);
  }

  /**
   * Fetches total difficulty for a block given its hash and number.
   */
  async getTotalDifficulty(blockHash: Buffer, blockNumber: BN): Promise<BN> {
    const td = await this.get(DBTarget.TotalDifficulty, { blockHash, blockNumber });
    return new BN(rlp.decode(td));
  }

  /**
   * Performs a block hash to block number lookup.
   */
  async hashToNumber(blockHash: Buffer): Promise<BN> {
    const value = await this.get(DBTarget.HashToNumber, { blockHash });
    return new BN(value);
  }

  /**
   * Performs a block number to block hash lookup.
   */
  async numberToHash(blockNumber: BN): Promise<Buffer> {
    if (blockNumber.ltn(0)) {
      throw new level.errors.NotFoundError();
    }

    return this.get(DBTarget.NumberToHash, { blockNumber });
  }

  /**
   * Fetches a key from the db. If `opts.cache` is specified
   * it first tries to load from cache, and on cache miss will
   * try to put the fetched item on cache afterwards.
   */
  async get(dbOperationTarget: DBTarget, key?: DatabaseKey): Promise<any> {
    const dbGetOperation = DBOp.get(dbOperationTarget, key);

    const cacheString = dbGetOperation.cacheString;
    const dbKey = dbGetOperation.baseDBOp.key;
    const dbOpts = dbGetOperation.baseDBOp;

    if (cacheString) {
      if (!this._cache[cacheString]) {
        throw new Error(`Invalid cache: ${cacheString}`);
      }

      let value = this._cache[cacheString].get(dbKey);
      if (!value) {
        value = <Buffer>await this._db.get(dbKey, dbOpts);
        this._cache[cacheString].set(dbKey, value);
      }

      return value;
    }

    return this._db.get(dbKey, dbOpts);
  }

  /**
   * Performs a batch operation on db.
   */
  async batch(ops: DBOp[]) {
    const convertedOps: DBOpData[] = ops.map((op) => op.baseDBOp);
    // update the current cache for each operation
    ops.map((op) => op.updateCache(this._cache));

    return this._db.batch(convertedOps as any);
  }

  //////////////////////////////////////

  /**
   * Get transaction by transaction hash
   * @param txHash - Transaction hash
   * @returns Transaction
   */
  async getTransaction(txHash: Buffer): Promise<Transaction> {
    const blockHeightBuffer = await this.get(DBTarget.TxLookup, { txHash });
    const blockHeight = new BN(blockHeightBuffer);
    const block = await this.getBlock(blockHeight);
    for (let i = 0; i < block.transactions.length; i++) {
      const tx = block.transactions[i];
      if (tx.hash().equals(txHash)) {
        const _tx = tx as Transaction;
        _tx.initExtension(block);
        return _tx;
      }
    }
    throw new level.errors.NotFoundError();
  }

  /**
   * Get transaction receipt by transaction hash
   * @param txHash - Transaction hash
   * @returns Receipt
   */
  async getReceipt(txHash: Buffer): Promise<Receipt> {
    const blockHeightBuffer = await this.get(DBTarget.TxLookup, { txHash });
    const blockHeihgt = new BN(blockHeightBuffer);
    const block = await this.getBlock(blockHeihgt);
    const rawArr = rlp.decode(await this.get(DBTarget.Receipts, { blockHash: block.hash(), blockNumber: blockHeihgt })) as unknown as Buffer[][];
    let lastCumulativeGasUsed = new BN(0);
    for (let i = 0; i < block.transactions.length; i++) {
      const tx = block.transactions[i] as Transaction;
      const receipt = Receipt.fromValuesArray(rawArr[i]);
      if (tx.hash().equals(txHash)) {
        const gasUsed = receipt.bnCumulativeGasUsed.sub(lastCumulativeGasUsed);
        receipt.initExtension(block, tx, gasUsed, i);
        return receipt;
      }
      lastCumulativeGasUsed = receipt.bnCumulativeGasUsed;
    }
    throw new level.errors.NotFoundError();
  }

  /**
   * Get receipts by block hash and number
   * @param number - Block number
   * @param hash - Block hash
   * @returns Receipts
   */
  async getReceipts(number: BN, hash: Buffer, block?: Block): Promise<Receipt[]> {
    const rawArr = rlp.decode(await this.get(DBTarget.Receipts, { blockHash: hash, blockNumber: number })) as unknown as Buffer[][];
    const receipts: Receipt[] = [];
    let lastCumulativeGasUsed = new BN(0);
    for (let i = 0; i < rawArr.length; i++) {
      const raw = rawArr[i];
      const receipt = Receipt.fromValuesArray(raw);
      const gasUsed = receipt.bnCumulativeGasUsed.sub(lastCumulativeGasUsed);
      block && receipt.initExtension(block, block.transactions[i] as Transaction, gasUsed, i);
      lastCumulativeGasUsed = receipt.bnCumulativeGasUsed;
      receipts.push(receipt);
    }
    return receipts;
  }

  /**
   * Get transaction receipt by block hash and block number
   * @param txHash - Transaction hash
   * @param blockHash - Block hash
   * @param blockNumber - Block number
   * @returns Transaction
   */
  async getReceiptByHashAndNumber(txHash: Buffer, blockHash: Buffer, blockNumber: BN): Promise<Receipt> {
    const header = rlp.decode(await this.get(DBTarget.Header, { blockHash, blockNumber })) as unknown as BlockHeaderBuffer;
    const body = await this.getBody(blockHash, blockNumber);
    const block = Block.fromValuesArray([header, ...body], { common: this._common, hardforkByBlockNumber: true });
    const rawArr = rlp.decode(await this.get(DBTarget.Receipts, { blockHash, blockNumber })) as unknown as Buffer[][];
    let lastCumulativeGasUsed = new BN(0);
    for (let i = 0; i < block.transactions.length; i++) {
      const tx = block.transactions[i] as Transaction;
      const receipt = Receipt.fromValuesArray(rawArr[i]);
      if (tx.hash().equals(txHash)) {
        const gasUsed = receipt.bnCumulativeGasUsed.sub(lastCumulativeGasUsed);
        receipt.initExtension(block, tx, gasUsed, i);
        return receipt;
      }
      lastCumulativeGasUsed = receipt.bnCumulativeGasUsed;
    }
    throw new level.errors.NotFoundError();
  }

  /**
   * Get block by block hash and block number
   * @param blockHash - Block hash
   * @param blockNumber - Block number
   * @returns Block
   */
  async getBlockByHashAndNumber(blockHash: Buffer, blockNumber: BN): Promise<Block> {
    const header = rlp.decode(await this.get(DBTarget.Header, { blockHash, blockNumber })) as unknown as BlockHeaderBuffer;
    let body: BlockBodyBuffer = [[], []];
    try {
      body = await this.getBody(blockHash, blockNumber);
    } catch (err: any) {
      if (err.type !== 'NotFoundError') {
        throw err;
      }
    }
    return Block.fromValuesArray([header, ...body], { common: this._common, hardforkByBlockNumber: true });
  }

  /**
   * Get bloom bits by section information
   * @param bit - Bit index of target section
   * @param section - Section number
   * @param hash - Hash of the last block header of the target section
   * @returns Bloom bits data
   */
  getBloomBits(bit: number, section: BN, hash: Buffer) {
    return this.get(DBTarget.BloomBits, { bit, section, hash });
  }

  /**
   * Get canonical chain block header by block number
   * @param num - Target block number
   * @returns Block header
   */
  async getCanonicalHeader(num: BN) {
    const hash = await this.numberToHash(num);
    return await this.getHeader(hash, num);
  }

  /**
   * Get section count of database
   * @returns section count or undefined(if doesn't exsit)
   */
  async getStoredSectionCount() {
    try {
      return new BN(await this.get(DBTarget.BloomBitsSectionCount));
    } catch (err: any) {
      if (err.type === 'NotFoundError') {
        return undefined;
      }
      throw err;
    }
  }

  /**
   * Get snapshot account
   * @param accountHash - Account address hash
   * @returns Serialized account
   */
  getSerializedSnapAccount(accountHash: Buffer): Promise<Buffer> {
    return this.get(DBTarget.SnapAccount, { accountHash });
  }

  /**
   * Get snapshot account storage
   * @param accountHash - Account address hash
   * @param storageHash - Account storage hash
   * @returns Account Storage value
   */
  getSnapStorage(accountHash: Buffer, storageHash: Buffer): Promise<Buffer> {
    return this.get(DBTarget.SnapStorage, { accountHash, storageHash });
  }

  /**
   * Get snapshot root
   */
  async getSnapRoot(): Promise<Buffer | null> {
    try {
      return await this.get(DBTarget.SnapRoot);
    } catch (err: any) {
      if (err.type === 'NotFoundError') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Get snapshot journal
   */
  async getSnapJournal(): Promise<Buffer | null> {
    try {
      return await this.get(DBTarget.SnapJournal);
    } catch (err: any) {
      if (err.type === 'NotFoundError') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Get snapshot generator
   */
  async getSnapGenerator(): Promise<Buffer | null> {
    try {
      return await this.get(DBTarget.SnapGenerator);
    } catch (err: any) {
      if (err.type === 'NotFoundError') {
        return null;
      }
      throw err;
    }
  }
}
