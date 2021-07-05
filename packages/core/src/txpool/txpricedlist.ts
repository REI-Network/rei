import { BN } from 'ethereumjs-util';
import Heap from 'qheap';
import { TypedTransaction } from '@gxchain2/structure';
import { txSlots } from './index';

export class TxPricedList {
  remotes: Heap;
  stales: number;
  all: Map<Buffer, TypedTransaction>;
  constructor(all: Map<Buffer, TypedTransaction>) {
    this.all = all;
    this.stales = 0;
    this.remotes = new Heap({ comparBefore: (a: TypedTransaction, b: TypedTransaction) => b.gasPrice.gt(a.gasPrice) });
  }

  /**
   * Inserts a new transaction into the heap
   * @param tx - The new transaction
   * @param local - Determine whether the transaction is local
   */
  put(tx: TypedTransaction, local: boolean) {
    if (local) {
      return;
    }
    this.remotes.push(tx);
  }

  /**
   * Notifies the prices transaction list that an old transaction dropped
   * from the pool. The list will just keep a counter of stale objects and update
   * the heap if a large enough ratio of transactions go stale.
   * @param count - The number of transactions to removed
   */
  removed(count: number) {
    this.stales += count;
    if (this.stales <= this.remotes.length / 4) {
      return;
    }
    this.reheap();
  }

  /**
   * Cap finds all the transactions below the given price threshold, drops them
   * from the priced list and returns them for further removal from the entire pool.
   * @param threshold The gasfee threshold of transaction
   * @returns The transactions to be abandoned
   */
  cap(threshold: BN): TypedTransaction[] {
    const drop: TypedTransaction[] = [];
    while (this.remotes.length > 0) {
      const cheapest: TypedTransaction = this.remotes.peek();
      if (!this.all.has(cheapest.hash())) {
        this.remotes.remove();
        this.stales--;
        continue;
      }
      if (cheapest.gasPrice.gte(threshold)) {
        break;
      }
      this.remotes.remove();
      drop.push(cheapest);
    }
    return drop;
  }

  /**
   * Checks whether a transaction is cheaper than (or as cheap as) the
   * lowest priced (remote) transaction currently being tracked.
   * @param tx The transaction to be checked
   * @returns Wheather the transaction is cheaper or not
   */
  underpriced(tx: TypedTransaction): boolean {
    while (this.remotes.length > 0) {
      const head: TypedTransaction = this.remotes.peek();
      if (!this.all.has(head.hash())) {
        this.stales--;
        this.remotes.remove();
        continue;
      }
      break;
    }
    if (this.remotes.length == 0) {
      return false;
    }
    const cheapest: TypedTransaction = this.remotes.peek();
    return cheapest.gasPrice.gt(tx.gasPrice);
  }

  /**
   *Finds a number of most underpriced transactions, removes them from the
   *priced list and returns them for further removal from the entire pool.
   * @param slots The solts threshold of transaction
   * @param force Mandatory or not
   * @returns A number of most underpriced transactions
   */
  discard(slots: number, force: boolean): [TypedTransaction[] | undefined, boolean] {
    const drop: TypedTransaction[] = [];
    while (this.remotes.length > 0 && slots > 0) {
      const tx: TypedTransaction = this.remotes.remove();
      if (!this.all.has(tx.hash())) {
        this.stales--;
        continue;
      }
      drop.push(tx);
      slots -= txSlots(tx);
    }
    if (slots > 0 && !force) {
      drop.forEach((tx) => {
        this.remotes.push(tx);
      });
      return [undefined, false];
    }
    return [drop, true];
  }

  /**
   * Reset heap
   */
  reheap() {
    const reheap = new Heap({ comparBefore: (a: TypedTransaction, b: TypedTransaction) => b.gasPrice.gt(a.gasPrice) });
    this.stales = 0;
    this.all.forEach((val, key, map) => {
      reheap.push(val);
    });
    this.remotes = reheap;
  }
}
