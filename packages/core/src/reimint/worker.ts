import { BN } from 'ethereumjs-util';
import Semaphore from 'semaphore-async-await';
import { BlockHeader, Transaction } from '@rei-network/structure';
import { logger, nowTimestamp } from '@rei-network/utils';
import { PendingTxMap } from '../txpool';
import { Node } from '../node';
import { ReimintEngine } from './engine';
import { PendingBlock } from './pendingBlock';

export interface WorkerOptions {
  node: Node;
  engine: ReimintEngine;
}

/**
 * Worker is responsible for making blocks.
 */
export class Worker {
  private readonly node: Node;
  private readonly engine: ReimintEngine;
  private readonly lock = new Semaphore(1);

  private pendingBlock?: PendingBlock;

  constructor(options: WorkerOptions) {
    this.node = options.node;
    this.engine = options.engine;
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

    // get pending transactions for txpool
    const txs = await this.node.txPool.getPendingTxMap(header.number, parentHash);

    // lock
    await this.lock.acquire();

    // calculate timestamp
    const now = nowTimestamp();
    const nexTimestamp1 = now + period;
    const nexTimestamp2 = header.timestamp.toNumber() + period;
    const nexTimestamp = nexTimestamp1 > nexTimestamp2 ? nexTimestamp1 : nexTimestamp2;

    this.pendingBlock = new PendingBlock(this.engine, parentHash, header.stateRoot, nextNumber, new BN(nexTimestamp), nextCommon);

    // unlock
    this.lock.release();

    if (txs) {
      // async append txs to pending block
      this.pendingBlock.appendTxs(txs).catch((err) => {
        logger.error('Worker::newBlockHeader, appendTxs, catch error:', err);
      });
    }

    return this.pendingBlock;
  }

  /**
   * Add transactions to pending block
   * @param _txs - Transactions
   */
  async addTxs(_txs: Map<Buffer, Transaction[]>) {
    // if the pendingHeader doesn't exist,
    // ignore new pending transaction
    if (!this.pendingBlock) {
      return;
    }

    const txs = new PendingTxMap();
    for (const [sender, sortedTxs] of _txs) {
      txs.push(sender, sortedTxs);
    }

    try {
      await this.lock.acquire();
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
