import { BN } from 'ethereumjs-util';
import Semaphore from 'semaphore-async-await';
import { BlockHeader, Transaction, Block, calcTransactionTrie, calcReceiptTrie, preHF1CalcReceiptTrie, Receipt } from '@gxchain2/structure';
import { PostByzantiumTxReceipt } from '@gxchain2-ethereumjs/vm/dist/types';
import VM from '@gxchain2-ethereumjs/vm';
import { RunTxResult } from '@gxchain2-ethereumjs/vm/dist/runTx';
import { logger, nowTimestamp } from '@gxchain2/utils';
import { isEnableReceiptRootFix } from '../hardforks';
import { PendingTxMap } from '../txpool';
import { Node } from '../node';
import { processTx } from '../vm';
import { ConsensusEngine } from '../consensus';
import { AsyncBufferRetriever } from './asyncRetriever';
import { postByzantiumTxReceiptsToReceipts } from '../vm';

const defaultMaxCacheSize = 10;
const defaultTimeoutDuration = 1000;

export interface WorkerOptions {
  node: Node;
  consensusEngine: ConsensusEngine;
  // max pending block cache size
  maxCacheSize?: number;
  // the timeout duration for getting a pending block
  timeoutDuration?: number;
}

/**
 * Worker is responsible for making blocks.
 */
export class Worker {
  private readonly node: Node;
  private readonly consensusEngine: ConsensusEngine;
  private readonly asyncRetriever: AsyncBufferRetriever<Block>;
  private readonly lock = new Semaphore(1);

  private vm!: VM;
  private parentHash!: Buffer;
  private pendingHeader!: BlockHeader;
  private pendingTxs!: Transaction[];
  private pendingReceipts!: Receipt[];
  private pendingGasUsed!: BN;

  constructor(options: WorkerOptions) {
    this.node = options.node;
    this.consensusEngine = options.consensusEngine;
    this.asyncRetriever = new AsyncBufferRetriever<Block>(options.maxCacheSize ?? defaultMaxCacheSize, options.timeoutDuration ?? defaultTimeoutDuration);
  }

  /**
   * Handler the latest block header.
   * Commit pending transaction and save
   * the pending block to `this.asyncRetriever`.
   * @param header - Latest block header.
   */
  async newBlockHeader(header: BlockHeader) {
    const parentHash = header.hash();
    if (this.asyncRetriever.has(parentHash)) {
      return;
    }

    try {
      await this.lock.acquire();
      if (this.vm) {
        await this.vm.stateManager.revert();
      }

      this.parentHash = parentHash;
      this.pendingTxs = [];
      this.pendingReceipts = [];
      this.pendingGasUsed = new BN(0);

      const nextNumber = header.number.addn(1);
      const nextCommon = this.node.getCommon(nextNumber);
      const period: number = nextCommon.consensusConfig().period;
      const now = nowTimestamp();
      let timestamp = header.timestamp.toNumber() + period;
      if (now > timestamp) {
        timestamp = now;
      }
      this.pendingHeader = this.consensusEngine.getPendingBlockHeader({ parentHash, number: nextNumber, timestamp });

      this.vm = await this.node.getVM(header.stateRoot, this.pendingHeader._common);
      await this.vm.stateManager.checkpoint();
      const pendingBlock = await this._commit(await this.node.txPool.getPendingTxMap(header.number, this.parentHash));
      this.asyncRetriever.push(parentHash, pendingBlock);
    } catch (err) {
      logger.error('Worker::_newBlockHeader, catch error:', err);
    } finally {
      this.lock.release();
    }
  }

  /**
   * Add transactions for commit
   * @param txs - The map of Buffer and array of transactions
   */
  async addTxs(txs: Map<Buffer, Transaction[]>) {
    // if the pendingHeader doesn't exsit,
    // ignore new pending transaction
    if (!this.pendingHeader) {
      return;
    }
    try {
      await this.lock.acquire();
      const pendingMap = new PendingTxMap();
      for (const [sender, sortedTxs] of txs) {
        pendingMap.push(sender, sortedTxs);
      }
      const pendingBlock = await this._commit(pendingMap);
      this.asyncRetriever.push(this.parentHash, pendingBlock);
    } catch (err) {
      logger.error('Worker::addTxs, catch error:', err);
    } finally {
      this.lock.release();
    }
  }

  /**
   * Get pending block by parent block hash.
   * @returns Pending block.
   */
  getPendingBlockByParentHash(hash: Buffer) {
    return this.asyncRetriever.retrieve(hash);
  }

  /**
   * Directly get pending block by parent block hash.
   * @returns Pending block.
   */
  directlyGetPendingBlockByParentHash(hash: Buffer) {
    return this.asyncRetriever.directlyRetrieve(hash);
  }

  /**
   * Get latest pending block.
   * @returns Pending block, return `undefined` if it doesn't exist
   */
  getLastPendingBlock() {
    return this.asyncRetriever.last();
  }

  /**
   * _commit runs any post-transaction state modifications,
   * check whether the fees of all transactions exceed the standard
   * @param pendingMap All pending transactions
   */
  private async _commit(pendingMap: PendingTxMap) {
    const pendingBlock = this.consensusEngine.getPendingBlock({ header: { ...this.pendingHeader } });
    let tx = pendingMap.peek();
    while (tx) {
      try {
        await this.vm.stateManager.checkpoint();

        let txRes: RunTxResult;
        tx = Transaction.fromTxData({ ...tx }, { common: this.pendingHeader._common });
        try {
          txRes = await processTx.bind(this.node)({
            vm: this.vm,
            tx,
            block: pendingBlock
          });
        } catch (err) {
          await this.vm.stateManager.revert();
          pendingMap.pop();
          tx = pendingMap.peek();
          continue;
        }

        if (pendingBlock.header.gasLimit.lt(txRes.gasUsed.add(this.pendingGasUsed))) {
          await this.vm.stateManager.revert();
          pendingMap.pop();
        } else {
          await this.vm.stateManager.commit();
          this.pendingTxs.push(tx);
          this.pendingReceipts.push(postByzantiumTxReceiptsToReceipts([txRes.receipt as PostByzantiumTxReceipt])[0]);
          this.pendingGasUsed.iadd(txRes.gasUsed);
          pendingMap.shift();
        }
      } catch (err) {
        logger.debug('Worker::_commit, catch error:', err);
        pendingMap.pop();
      } finally {
        tx = pendingMap.peek();
      }
    }

    // calculate receipt trie, state root, transaction trie
    let receiptTrie: Buffer;
    if (isEnableReceiptRootFix(this.pendingHeader._common)) {
      receiptTrie = await calcReceiptTrie(this.pendingReceipts);
    } else {
      receiptTrie = await preHF1CalcReceiptTrie(this.pendingReceipts);
    }
    const transactionsTrie = await calcTransactionTrie(this.pendingTxs);
    const stateRoot = await this.vm.stateManager.getStateRoot();

    return this.consensusEngine.getPendingBlock({ header: { ...this.pendingHeader, receiptTrie, transactionsTrie, stateRoot, gasUsed: this.pendingGasUsed.clone() }, transactions: [...this.pendingTxs] });
  }
}
