import { BN, KECCAK256_RLP_ARRAY, BNLike } from 'ethereumjs-util';
import Semaphore from 'semaphore-async-await';
import VM from '@gxchain2-ethereumjs/vm';
import Bloom from '@gxchain2-ethereumjs/vm/dist/bloom';
import { RunTxResult } from '@gxchain2-ethereumjs/vm/dist/runTx';
import { Transaction, calcTransactionTrie, HeaderData } from '@gxchain2/structure';
import { logger } from '@gxchain2/utils';
import { Common } from '@gxchain2/common';
import { PendingTxMap } from '../txpool';
import { ConsensusEngine, FinalizeOpts } from './types';
import { EMPTY_ADDRESS, EMPTY_NONCE, EMPTY_MIX_HASH, EMPTY_EXTRA_DATA } from '../utils';

export interface PendingBlockFinalizeOpts extends Pick<FinalizeOpts, 'round' | 'evidence'> {}

export interface PendingBlockBackend {
  getVM(root: Buffer, num: BNLike | Common): Promise<VM>;
}

export class PendingBlock {
  private backend: PendingBlockBackend;
  private engine: ConsensusEngine;
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
  private transactionResults: RunTxResult[] = [];
  private latestStateRoot?: Buffer;

  private bloom?: Buffer;
  private receiptTrie?: Buffer;
  private transactionsTrie?: Buffer;
  private finalizedStateRoot?: Buffer;

  constructor(backend: PendingBlockBackend, engine: ConsensusEngine, parentHash: Buffer, parentStateRoot: Buffer, number: BN, timestamp: BN, common: Common, extraData?: Buffer) {
    if (extraData && extraData.length !== 32) {
      throw new Error('invalid extra data length');
    }
    this.backend = backend;
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
    return this.runWithLock(async () => {
      // create a empty block for execute transaction
      const pendingBlock = this.engine.generatePendingBlock(this.toHeaderData(), this._common);
      const gasLimit = pendingBlock.header.gasLimit;
      // create vm instance
      const vm = await this.backend.getVM(this.latestStateRoot ?? this._parentStateRoot, this._common);

      let tx = txs.peek();
      while (tx) {
        try {
          await vm.stateManager.checkpoint();

          let txRes: RunTxResult;
          tx = Transaction.fromTxData({ ...tx }, { common: this._common });
          try {
            txRes = await this.engine.processTx({
              vm,
              tx,
              block: pendingBlock
            });
          } catch (err) {
            await vm.stateManager.revert();
            txs.pop();
            tx = txs.peek();
            continue;
          }

          if (txRes.gasUsed.add(this.gasUsed).gt(gasLimit)) {
            await vm.stateManager.revert();
            txs.pop();
          } else {
            await vm.stateManager.commit();
            const stateRoot = await vm.stateManager.getStateRoot();

            // save transaction info
            this.transactions.push(tx);
            this.transactionResults.push(txRes);
            this.gasUsed.iadd(txRes.gasUsed);
            this.latestStateRoot = stateRoot;

            // clear finalized info
            this.bloom = undefined;
            this.receiptTrie = undefined;
            this.transactionsTrie = undefined;
            this.finalizedStateRoot = undefined;

            txs.shift();
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
      // calculate finalizedStateRoot and receiptTrie
      const { finalizedStateRoot, receiptTrie } = await this.engine.finalize({
        ...options,
        receipts: this.transactionResults.map(({ receipt }) => receipt),
        block: this.engine.generatePendingBlock(this.toHeaderData(), this._common),
        stateRoot: this.latestStateRoot ?? this._parentStateRoot,
        parentStateRoot: this._parentStateRoot,
        transactions: this.transactions
      });
      this.finalizedStateRoot = finalizedStateRoot;
      this.receiptTrie = receiptTrie;

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
}
