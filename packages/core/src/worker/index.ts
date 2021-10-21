import { BN } from 'ethereumjs-util';
import Semaphore from 'semaphore-async-await';
import { BlockHeader, Transaction } from '@gxchain2/structure';
import { logger, nowTimestamp } from '@gxchain2/utils';
import { PendingTxMap } from '../txpool';
import { Node } from '../node';
import { ConsensusEngine } from '../consensus';
import { PendingBlock } from './pendingBlock';

export * from './pendingBlock';

export interface WorkerOptions {
  node: Node;
  consensusEngine: ConsensusEngine;
}

/**
 * Worker is responsible for making blocks.
 */
export class Worker {
  private readonly node: Node;
  private readonly consensusEngine: ConsensusEngine;
  private readonly lock = new Semaphore(1);

  private pendingBlock?: PendingBlock;

  constructor(options: WorkerOptions) {
    this.node = options.node;
    this.consensusEngine = options.consensusEngine;
  }

  /**
   * Create a new pending block after header
   * @param header - Latest block header.
   */
  async createPendingBlock(header: BlockHeader) {
    const parentHash = header.hash();
    if (this.pendingBlock && this.pendingBlock.parentHash.equals(parentHash)) {
      return this.pendingBlock;
    }

    const nextNumber = header.number.addn(1);
    const nextCommon = this.node.getCommon(nextNumber);
    const period: number = nextCommon.consensusConfig().period;
    const now = nowTimestamp();
    let nexTimestamp = header.timestamp.toNumber() + period;
    if (now > nexTimestamp) {
      nexTimestamp = now;
    }

    const newPendingBlock = new PendingBlock(parentHash, header.stateRoot, nextNumber, new BN(nexTimestamp), nextCommon, this.consensusEngine, this.node);

    let txs: PendingTxMap | undefined;
    try {
      await this.lock.acquire();

      // get pending transactions for txpool
      txs = await this.node.txPool.getPendingTxMap(header.number, parentHash);
      this.pendingBlock = newPendingBlock;

      return this.pendingBlock;
    } catch (err) {
      logger.error('Worker::newBlockHeader, catch error:', err);
      this.pendingBlock = undefined;
      // return an empty pending block
      return newPendingBlock;
    } finally {
      this.lock.release();

      if (txs) {
        // async append txs to pending block
        newPendingBlock?.appendTxs(txs);
      }
    }
  }

  /**
   * Add transactions to pending block
   * @param _txs - Transactions
   */
  async addTxs(_txs: Map<Buffer, Transaction[]>) {
    // if the pendingHeader doesn't exsit,
    // ignore new pending transaction
    if (!this.pendingBlock) {
      return;
    }

    try {
      await this.lock.acquire();

      const txs = new PendingTxMap();
      for (const [sender, sortedTxs] of _txs) {
        txs.push(sender, sortedTxs);
      }
      await this.pendingBlock.appendTxs(txs);
    } catch (err) {
      logger.error('Worker::addTxs, catch error:', err);
    } finally {
      this.lock.release();
    }
  }

  /**
   * Get current pending block.
   * @returns Pending block, return `undefined` if it doesn't exist
   */
  getPendingBlock() {
    return this.pendingBlock;
  }
}
