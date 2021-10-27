import { BN, KECCAK256_RLP_ARRAY, Address } from 'ethereumjs-util';
import Semaphore from 'semaphore-async-await';
import Bloom from '@gxchain2-ethereumjs/vm/dist/bloom';
import { RunTxResult } from '@gxchain2-ethereumjs/vm/dist/runTx';
import { Transaction, calcTransactionTrie, HeaderData } from '@gxchain2/structure';
import { logger } from '@gxchain2/utils';
import { Common } from '@gxchain2/common';
import { PendingTxMap } from '../txpool';
import { makeRunBlockCallback, processTx } from '../vm';
import { Node } from '../node';
import { ValidatorSet } from '../staking';
import { StakeManager } from '../contracts';
import { ConsensusEngine } from '../consensus';
import { isEnableStaking } from '../hardforks';

const EMPTY_ADDRESS = Address.zero();
const EMPTY_MIX_HASH = Buffer.alloc(32);
const EMPTY_NONCE = Buffer.alloc(8);
const EMPTY_EXTRA_DATA = Buffer.alloc(32);

export class PendingBlock {
  private engine: ConsensusEngine;
  private node: Node;
  private lock = new Semaphore(1);

  private _common: Common;
  private _parentHash: Buffer;
  private parentStateRoot: Buffer;
  private _number: BN;
  private _timestamp: BN;
  private extraData: Buffer;

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

  private times?: number;

  constructor(parentHash: Buffer, parentStateRoot: Buffer, number: BN, timestamp: BN, common: Common, engine: ConsensusEngine, node: Node, extraData?: Buffer) {
    if (extraData && extraData.length !== 32) {
      throw new Error('invalid extra data length');
    }
    this.engine = engine;
    this.node = node;
    this._common = common;
    this._parentHash = parentHash;
    this.parentStateRoot = parentStateRoot;
    this._number = number.clone();
    this._timestamp = timestamp.clone();
    this.extraData = extraData ?? EMPTY_EXTRA_DATA;
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

  get isCompleted() {
    return this.difficulty !== undefined && this.gasLimit !== undefined;
  }

  get isFinalized() {
    return !!this.finalizedStateRoot;
  }

  /**
   * Create a simple signed block through engine,
   * notice: it may be incompleted
   * @returns Block
   */
  toSimpleSignedBlock() {
    return this.engine.simpleSignBlock(this.toHeaderData(), this._common);
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
      extraData: this.extraData,
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
      const pendingBlock = this.toSimpleSignedBlock();
      const gasLimit = pendingBlock.header.gasLimit;
      // create vm instance
      const vm = await this.node.getVM(this.latestStateRoot ?? this.parentStateRoot, this._common);

      let tx = txs.peek();
      while (tx) {
        try {
          await vm.stateManager.checkpoint();

          let txRes: RunTxResult;
          tx = Transaction.fromTxData({ ...tx }, { common: this._common });
          try {
            txRes = await processTx.bind(this.node)({
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
            this.times = undefined;

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
   * @param times - Increase the number of times the proposer priority of the parent validator set,
   *                this arg is used for reimint consensus engine
   * @returns makeBlockData result
   */
  finalize(times?: number) {
    this.requireCompleted();
    return this.runWithLock(async () => {
      if (this.finalizedStateRoot && this.times === times) {
        return this.makeBlockData();
      }

      const pendingBlock = this.toSimpleSignedBlock();
      const enableStaking = isEnableStaking(this._common);
      // create vm instance
      const vm = await this.node.getVM(this.latestStateRoot ?? this.parentStateRoot, this._common);
      let parentValidatorSet: ValidatorSet | undefined;
      let parentStakeManager: StakeManager | undefined;
      if (enableStaking) {
        parentStakeManager = this.node.getStakeManager(vm, pendingBlock);
        parentValidatorSet = await this.node.validatorSets.get(this.parentStateRoot, parentStakeManager);
        if (times) {
          parentValidatorSet = parentValidatorSet.copy();
          parentValidatorSet.incrementProposerPriority(times);
        }
      }

      const { genReceiptTrie, assignBlockReward, afterApply } = await makeRunBlockCallback(this.node, vm, this.engine, pendingBlock, undefined, parentStakeManager, parentValidatorSet);

      const minerReward = new BN(this._common.param('pow', 'minerReward'));
      await vm.stateManager.checkpoint();
      try {
        await assignBlockReward(vm.stateManager, minerReward);
        await afterApply(vm.stateManager, { receipts: this.transactionResults.map(({ receipt }) => receipt) });
        await vm.stateManager.commit();
        this.finalizedStateRoot = await vm.stateManager.getStateRoot();
      } catch (err) {
        await vm.stateManager.revert();
        throw err;
      }

      // calculate receipt trie
      this.receiptTrie = await genReceiptTrie(
        this.transactions,
        this.transactionResults.map(({ receipt }) => receipt)
      );

      // calculate transactions trie
      this.transactionsTrie = await calcTransactionTrie(this.transactions);

      // calculate bloom
      const bloom = new Bloom();
      for (const txResult of this.transactionResults) {
        bloom.or(txResult.bloom);
      }
      this.bloom = bloom.bitvector;

      // save times
      this.times = times;
      return this.makeBlockData();
    });
  }
}
