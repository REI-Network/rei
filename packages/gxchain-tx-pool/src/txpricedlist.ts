import { Transaction } from '@gxchain2/tx';
import Heap from 'qheap';
import { txSlots } from './index';

export class TxPricedList {
  remotes: Heap;
  stales: number;
  all: Map<Buffer, Transaction>;
  constructor(all: Map<Buffer, Transaction>, stales: number) {
    this.all = all;
    this.stales = 0;
    this.remotes = new Heap({ comparBefore: (a: Transaction, b: Transaction) => a.gasPrice.gt(b.gasPrice) });
  }

  Put(tx: Transaction, local: Boolean) {
    if (local) {
      return;
    }
    this.remotes.push(tx);
  }

  Removed(count: number) {
    this.stales += count;
    if (this.stales <= this.remotes.length / 4) {
      return;
    }
    this.Reheap();
  }

  Cap(threshold: number): Transaction[] {
    let drop: Transaction[] = [];
    while (this.remotes.length > 0) {
      let cheapest = this.remotes[0];
      if (!this.all.has(cheapest.hash())) {
        this.remotes.remove();
        this.stales--;
        continue;
      }
      if (cheapest.gasPrice.gten(threshold)) {
        break;
      }
      this.remotes.remove();
      drop.push(cheapest);
    }
    return drop;
  }

  Underpriced(tx: Transaction): Boolean {
    while (this.remotes.length > 0) {
      const head: Transaction = this.remotes[0];
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
    let cheapest: Transaction = this.remotes[0];
    return cheapest.gasPrice.gt(tx.gasPrice);
  }

  Discard(slots: number, force: Boolean): [Transaction[] | undefined, Boolean] {
    let drop: Transaction[] = new Array(slots);
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

  Reheap() {
    let reheap = new Heap({ comparBefore: (a: Transaction, b: Transaction) => a.gasPrice.gt(b.gasPrice) });
    this.stales = 0;
    this.all.forEach((val, key, map) => {
      reheap.push(val);
    });
    this.remotes = reheap;
  }
}
