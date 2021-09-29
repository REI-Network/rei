import { BN } from 'ethereumjs-util';
import Semaphore from 'semaphore-async-await';
import { BlockHeader, Transaction } from '@gxchain2/structure';
import VM from '@gxchain2-ethereumjs/vm';
import { RunTxResult } from '@gxchain2-ethereumjs/vm/dist/runTx';
import { logger } from '@gxchain2/utils';
import { PendingTxMap } from '../txpool';
import { Node } from '../node';
import { processTx } from '../vm';
import { ConsensusEngine } from '../consensus';
import { AsyncBufferRetriever } from './asyncRetriever';

const defaultMaxCacheSize = 10;
const defaultTimeoutDuration = 1000;

export interface WorkerOptions {
  node: Node;
  ce: ConsensusEngine;
  maxCacheSize?: number;
  timeoutDuration?: number;
}

/**
 * Miner creates blocks and searches for proof-of-work values.
 */
export class Worker {
  private readonly node: Node;
  private readonly initPromise: Promise<void>;
  private readonly ce: ConsensusEngine;
  private readonly abr: AsyncBufferRetriever<Transaction[]>;
  private readonly lock = new Semaphore(1);

  private vm!: VM;
  private parentHash!: Buffer;
  private pendingNumber!: BN;
  private pendingTxs!: Transaction[];
  private pendingGasUsed!: BN;

  constructor(options: WorkerOptions) {
    this.node = options.node;
    this.ce = options.ce;
    this.abr = new AsyncBufferRetriever<Transaction[]>(options.maxCacheSize ?? defaultMaxCacheSize, options.timeoutDuration ?? defaultTimeoutDuration);
    this.initPromise = this.init();
  }

  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    await this._newBlockHeader(this.node.blockchain.latestBlock.header);
  }

  async newBlockHeader(header: BlockHeader) {
    await this.initPromise;
    await this._newBlockHeader(header);
  }

  private async _newBlockHeader(header: BlockHeader) {
    const parentHash = header.hash();
    if (this.abr.has(parentHash)) {
      return;
    }

    try {
      await this.lock.acquire();
      if (this.vm) {
        await this.vm.stateManager.revert();
      }

      this.pendingTxs = [];
      this.pendingGasUsed = new BN(0);
      this.parentHash = parentHash;
      this.pendingNumber = header.number.addn(1);

      this.vm = await this.node.getVM(header.stateRoot, this.pendingNumber);
      await this.vm.stateManager.checkpoint();
      await this._commit(await this.node.txPool.getPendingTxMap(header.number, this.parentHash));
      this.abr.push(this.parentHash, [...this.pendingTxs]);
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
    await this.initPromise;
    try {
      await this.lock.acquire();
      const pendingMap = new PendingTxMap();
      for (const [sender, sortedTxs] of txs) {
        pendingMap.push(sender, sortedTxs);
      }
      await this._commit(pendingMap);
      this.abr.update(this.parentHash, [...this.pendingTxs]);
    } catch (err) {
      logger.error('Worker::addTxs, catch error:', err);
    } finally {
      this.lock.release();
    }
  }

  /**
   * Assembles the pending block from block data
   * @returns
   */
  async getPendingTxsByParentHash(hash: Buffer) {
    await this.initPromise;
    return this.abr.retrieve(hash);
  }

  /**
   * _commit runs any post-transaction state modifications,
   * check whether the fees of all transactions exceed the standard
   * @param pendingMap All pending transactions
   */
  private async _commit(pendingMap: PendingTxMap) {
    let tx = pendingMap.peek();
    while (tx) {
      try {
        await this.vm.stateManager.checkpoint();

        let txRes: RunTxResult;
        tx.common.setHardforkByBlockNumber(this.pendingNumber);
        try {
          txRes = await processTx.bind(this.node)({
            vm: this.vm,
            tx,
            block: this.ce.Block_fromBlockData({}, { common: tx.common })
          });
        } catch (err) {
          await this.vm.stateManager.revert();
          pendingMap.pop();
          tx = pendingMap.peek();
          continue;
        }

        if (this.ce.getGasLimitByCommon(tx.common).lt(txRes.gasUsed.add(this.pendingGasUsed))) {
          await this.vm.stateManager.revert();
          pendingMap.pop();
        } else {
          await this.vm.stateManager.commit();
          this.pendingTxs.push(tx);
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
  }
}
