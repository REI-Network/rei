import { Transaction, WrappedTransaction } from '@gxchain2/tx';
import BN from 'bn.js';
import Heap from 'qheap';
import { txSlots } from './index';

export class TxPricedList {
  remotes: Heap;
  stales: number;
  all: Map<Buffer, WrappedTransaction>;
  constructor(all: Map<Buffer, WrappedTransaction>) {
    this.all = all;
    this.stales = 0;
    this.remotes = new Heap({ comparBefore: (a: WrappedTransaction, b: WrappedTransaction) => b.transaction.gasPrice.gt(a.transaction.gasPrice) });
  }

  put(tx: WrappedTransaction, local: boolean) {
    if (local) {
      return;
    }
    this.remotes.push(tx);
  }

  removed(count: number) {
    this.stales += count;
    if (this.stales <= this.remotes.length / 4) {
      return;
    }
    this.reheap();
  }

  cap(threshold: BN): WrappedTransaction[] {
    const drop: WrappedTransaction[] = [];
    while (this.remotes.length > 0) {
      const cheapest: WrappedTransaction = this.remotes.peek();
      if (!this.all.has(cheapest.transaction.hash())) {
        this.remotes.remove();
        this.stales--;
        continue;
      }
      if (cheapest.transaction.gasPrice.gte(threshold)) {
        break;
      }
      this.remotes.remove();
      drop.push(cheapest);
    }
    return drop;
  }

  underpriced(tx: WrappedTransaction): boolean {
    while (this.remotes.length > 0) {
      const head: WrappedTransaction = this.remotes.peek();
      if (!this.all.has(head.transaction.hash())) {
        this.stales--;
        this.remotes.remove();
        continue;
      }
      break;
    }
    if (this.remotes.length == 0) {
      return false;
    }
    const cheapest: WrappedTransaction = this.remotes.peek();
    return cheapest.transaction.gasPrice.gt(tx.transaction.gasPrice);
  }

  discard(slots: number, force: boolean): [WrappedTransaction[] | undefined, boolean] {
    const drop: WrappedTransaction[] = [];
    while (this.remotes.length > 0 && slots > 0) {
      const tx: WrappedTransaction = this.remotes.remove();
      if (!this.all.has(tx.transaction.hash())) {
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

  reheap() {
    const reheap = new Heap({ comparBefore: (a: WrappedTransaction, b: WrappedTransaction) => b.transaction.gasPrice.gt(a.transaction.gasPrice) });
    this.stales = 0;
    this.all.forEach((val, key, map) => {
      reheap.push(val);
    });
    this.remotes = reheap;
  }
}
