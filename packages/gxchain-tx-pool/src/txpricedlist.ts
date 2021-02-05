import { Transaction } from '@gxchain2/tx';
import BN from 'bn.js';
import Heap from 'qheap';
import { txSlots } from './index';

export class TxPricedList {
  remotes: Heap;
  stales: number;
  all: Map<Buffer, Transaction>;
  constructor(all: Map<Buffer, Transaction>) {
    this.all = all;
    this.stales = 0;
    this.remotes = new Heap({ comparBefore: (a: Transaction, b: Transaction) => b.gasPrice.gt(a.gasPrice) });
  }

  put(tx: Transaction, local: boolean) {
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

  cap(threshold: BN): Transaction[] {
    let drop: Transaction[] = [];
    while (this.remotes.length > 0) {
      let cheapest: Transaction = this.remotes.peek();
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

  underpriced(tx: Transaction): boolean {
    while (this.remotes.length > 0) {
      const head: Transaction = this.remotes.peek();
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
    let cheapest: Transaction = this.remotes.peek();
    return cheapest.gasPrice.gt(tx.gasPrice);
  }

  discard(slots: number, force: boolean): [Transaction[] | undefined, boolean] {
    let drop: Transaction[] = [];
    while (this.remotes.length > 0 && slots > 0) {
      let tx: Transaction = this.remotes.remove();
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

  reheap() {
    let reheap = new Heap({ comparBefore: (a: Transaction, b: Transaction) => b.gasPrice.gt(a.gasPrice) });
    this.stales = 0;
    this.all.forEach((val, key, map) => {
      reheap.push(val);
    });
    this.remotes = reheap;
  }
}
