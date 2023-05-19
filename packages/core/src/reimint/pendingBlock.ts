import { BN, KECCAK256_RLP_ARRAY } from 'ethereumjs-util';
import Semaphore from 'semaphore-async-await';
import Bloom from '@rei-network/vm/dist/bloom';
import { Transaction, calcTransactionTrie, HeaderData } from '@rei-network/structure';
import { logger } from '@rei-network/utils';
import { Common } from '@rei-network/common';
import { PendingTxMap } from '../txpool';
import { EMPTY_ADDRESS, EMPTY_NONCE, EMPTY_MIX_HASH, EMPTY_EXTRA_DATA } from '../utils';
import { isEnableDAO, isEnableFreeStaking } from '../hardforks';
import { FinalizeOpts, ProcessTxResult } from './executor';
import { ReimintEngine } from './engine';

export interface PendingBlockFinalizeOpts extends Pick<FinalizeOpts, 'round' | 'evidence'> {}

export class PendingBlock {
  private engine: ReimintEngine;
  private lock = new Semaphore(1);

  private _common: Common;
  private _parentHash: Buffer;
  private _parentStateRoot: Buffer;
  private _number: BN;
  private _timestamp: BN;
  private _extraData: Buffer;

  private difficulty?: BN;
  private gasLimit?: BN;

  private nonce = EMPTY_NONCE;
  private uncleHash = KECCAK256_RLP_ARRAY;
  private coinbase = EMPTY_ADDRESS;
  private mixHash = EMPTY_MIX_HASH;

  private gasUsed: BN = new BN(0);
  private transactions: Transaction[] = [];
  private transactionResults: ProcessTxResult[] = [];
  private latestStateRoot?: Buffer;

  private bloom?: Buffer;
  private receiptTrie?: Buffer;
  private transactionsTrie?: Buffer;
  private finalizedStateRoot?: Buffer;

  private stopped: boolean = false;

  private totalAmount?: BN;
  private dailyFee?: BN;

  constructor(engine: ReimintEngine, parentHash: Buffer, parentStateRoot: Buffer, number: BN, timestamp: BN, common: Common, extraData?: Buffer) {
    if (extraData && extraData.length !== 32) {
      throw new Error('invalid extra data length');
    }
    this.engine = engine;
    this._common = common;
    this._parentHash = parentHash;
    this._parentStateRoot = parentStateRoot;
    this._number = number.clone();
    this._timestamp = timestamp.clone();
    this._extraData = extraData ?? EMPTY_EXTRA_DATA;
  }

  get parentHash() {
    return this._parentHash;
  }

  get number() {
    return this._number;
  }

  get common() {
    return this._common;
  }

  get timestamp() {
    return this._timestamp.toNumber();
  }

  get pendingStateRoot() {
    return this.finalizedStateRoot ?? this.latestStateRoot ?? this._parentStateRoot;
  }

  get isCompleted() {
    return this.difficulty !== undefined && this.gasLimit !== undefined;
  }

  get isFinalized() {
    return !!this.finalizedStateRoot;
  }

  /**
   * Convert data to HeaderData format
   * @returns HeaderData
   */
  toHeaderData(): HeaderData {
    return {
      parentHash: this._parentHash,
      number: this._number,
      timestamp: this._timestamp,
      extraData: this._extraData,
      difficulty: this.difficulty,
      gasLimit: this.gasLimit,
      nonce: this.nonce,
      uncleHash: this.uncleHash,
      coinbase: this.coinbase,
      mixHash: this.mixHash,
      gasUsed: this.gasUsed,
      stateRoot: this.finalizedStateRoot,
      bloom: this.bloom,
      receiptTrie: this.receiptTrie,
      transactionsTrie: this.transactionsTrie
    };
  }

  /**
   * Complete the pending block
   * @param difficulty - Difficulty(determined by consensus engine)
   * @param gasLimit - GasLimit(determined by consensus engine)
   */
  complete(difficulty: BN, gasLimit: BN) {
    this.difficulty = difficulty.clone();
    this.gasLimit = gasLimit.clone();
  }

  /**
   * Ensure the pending block is completed
   */
  private requireCompleted() {
    if (!this.isCompleted) {
      throw new Error('pending block is uncompleted');
    }
  }

  private async runWithLock<T>(fn: () => Promise<T>) {
    try {
      await this.lock.acquire();
      return await fn();
    } catch (err) {
      throw err;
    } finally {
      this.lock.release();
    }
  }

  /**
   * Append new pending transactions to the pending block
   * @param txs - PendingTxMap instance(created by txpool)
   */
  appendTxs(txs: PendingTxMap) {
    /**
     * TODO: We should continue to try to append transactions instead of returning directly,
     *       here the return is for performance considerations
     */
    if (this.finalizedStateRoot) {
      return Promise.resolve();
    }

    // if we have stopped, then just return
    if (this.stopped) {
      return Promise.resolve();
    }

    return this.runWithLock(async () => {
      /**
       * TODO: We should continue to try to append transactions instead of returning directly,
       *       here the return is for performance considerations
       */
      if (this.finalizedStateRoot) {
        return;
      }

      // if we have stopped, then just return
      if (this.stopped) {
        return;
      }

      // create a empty block for execute transaction
      const pendingBlock = this.engine.generatePendingBlock(this.toHeaderData(), this._common);
      const gasLimit = pendingBlock.header.gasLimit;

      // if free staking is enable, initialize variables
      if (isEnableFreeStaking(this._common)) {
        if (this.totalAmount === undefined) {
          this.totalAmount = await this.engine.getTotalAmount(this._parentStateRoot, this._common);
        }
      }

      // load parent block header
      const parent = await this.engine.node.db.getHeader(this.parentHash, this.number.subn(1));
      const parentCommon = parent._common;
      // load parent vm
      const parentVM = await this.engine.node.getVM(parent.stateRoot, parentCommon);

      // if dao is enable, load daily fee from contract
      if (isEnableDAO(parentCommon)) {
        if (this.dailyFee === undefined) {
          const config = await this.engine.getConfig(parentVM, pendingBlock);
          this.dailyFee = await config.dailyFee();
        }
      }

      let tx = txs.peek();
      while (tx) {
        try {
          let txRes: ProcessTxResult;
          tx = Transaction.fromTxData({ ...tx }, { common: this._common });
          try {
            txRes = await this.engine.executor.processTx({
              tx,
              root: this.latestStateRoot ?? this._parentStateRoot,
              block: pendingBlock,
              blockGasUsed: this.gasUsed,
              totalAmount: this.totalAmount,
              dailyFee: this.dailyFee
            });
          } catch (err) {
            txs.pop();
            tx = txs.peek();
            continue;
          }

          if (txRes.gasUsed.add(this.gasUsed).gt(gasLimit)) {
            txs.pop();

            /**
             * TODO: We should continue to try to execute the transaction until the block limit is reached,
             *       the return here is for performance considerations
             */
            return;
          } else {
            // save transaction info
            this.transactions.push(tx);
            this.transactionResults.push(txRes);
            this.gasUsed.iadd(txRes.gasUsed);
            this.latestStateRoot = txRes.root;

            // clear finalized info
            this.bloom = undefined;
            this.receiptTrie = undefined;
            this.transactionsTrie = undefined;
            this.finalizedStateRoot = undefined;

            txs.shift();
          }

          // if we have stopped, then just return
          if (this.stopped) {
            return;
          }
        } catch (err) {
          logger.debug('PendingBlock::appendTx, catch error:', err);
          txs.pop();
        } finally {
          tx = txs.peek();
        }
      }
    });
  }

  /**
   * Get header data and transactions
   */
  makeBlockData() {
    return {
      header: this.toHeaderData(),
      transactions: [...this.transactions]
    };
  }

  /**
   * Finalize the pending block,
   * it will assign block rewards to miner
   * and do other things...
   * @param options - Finalize options
   * @returns makeBlockData result
   */
  finalize(options?: PendingBlockFinalizeOpts) {
    this.requireCompleted();
    return this.runWithLock(async () => {
      const receipts = this.transactionResults.map(({ receipt }) => receipt);

      // calculate finalizedStateRoot
      const { finalizedStateRoot } = await this.engine.executor.finalize({
        ...options,
        receipts,
        block: this.engine.generatePendingBlock(this.toHeaderData(), this._common),
        stateRoot: this.latestStateRoot ?? this._parentStateRoot,
        parentStateRoot: this._parentStateRoot
      });
      this.finalizedStateRoot = finalizedStateRoot;

      // calculate receipts trie
      this.receiptTrie = await this.engine.generateReceiptTrie(this.transactions, receipts);

      // calculate transactions trie
      this.transactionsTrie = await calcTransactionTrie(this.transactions);

      // calculate bloom
      const bloom = new Bloom();
      for (const txResult of this.transactionResults) {
        bloom.or(txResult.bloom);
      }
      this.bloom = bloom.bitvector;

      return this.makeBlockData();
    });
  }

  /**
   * Stop appending pending transactions
   */
  stop() {
    this.stopped = true;
  }
}
