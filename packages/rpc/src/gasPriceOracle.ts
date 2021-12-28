import { BN } from 'ethereumjs-util';
import { Channel } from '@rei-network/utils';
import { Block, Transaction } from '@rei-network/structure';
import { Backend } from './types';

const defaultGasPrice = 1000000000;

type Task = Buffer[];

/**
 * TODO: improve oracle logic
 */
export class SimpleOracle {
  private backend: Backend;
  private taskQueue = new Channel<Task>();
  private avgGasPrice?: BN;

  constructor(backend: Backend) {
    this.backend = backend;
  }

  get gasPrice() {
    return this.avgGasPrice?.clone() ?? new BN(defaultGasPrice);
  }

  private onNewHeads = (hashes: Buffer[]) => {
    this.taskQueue.push(hashes);
  };

  private async taskLoop() {
    for await (const hashes of this.taskQueue.generator()) {
      try {
        if (hashes.length > 0) {
          const hash = hashes[hashes.length - 1];
          const block: Block = await this.backend.db.getBlock(hash);
          if (block.transactions.length > 0) {
            const totalGasPrice = new BN(0);
            for (const tx of block.transactions as Transaction[]) {
              totalGasPrice.iadd(tx.gasPrice);
            }
            this.avgGasPrice = totalGasPrice.divn(block.transactions.length);
            if (this.avgGasPrice.isZero()) {
              this.avgGasPrice = new BN(1);
            }
          } else {
            this.avgGasPrice = undefined;
          }
        }
      } catch (err) {
        // ignore errors ...
      }
    }
  }

  /**
   * Start oracle
   */
  start() {
    this.taskLoop();
    this.backend.bcMonitor.on('newHeads', this.onNewHeads);
  }

  /**
   * Abort oracle
   */
  abort() {
    this.taskQueue.abort();
    this.backend.bcMonitor.off('newHeads', this.onNewHeads);
  }
}
