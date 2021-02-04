import { Transaction } from '@gxchain2/tx';
import Heap from 'qheap';

export class TxPricedList {
  private h: Heap;
  stales: number;
  all: Map<Buffer, Transaction>;
  remotes: Transaction[];
  constructor(all: Map<Buffer, Transaction>, stales: number) {
    this.all = all;
    this.remotes = [];
    this.stales = 0;
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

  Cap(threshold: number) {
    let drop: Transaction[] = [];
    while (this.remotes.length > 0) {
      let cheapest = this.remotes[0];
      if (this.all.has(cheapest.hash())) {
      }
    }
  }

  Underpriced(tx: Transaction) {}

  Discard(slot: number, force: Boolean) {}

  Reheap() {
    let reheap: Transaction[] = new Array(Array.from(this.all.keys()).length);
    this.stales = 0;
    this.remotes = reheap;
    this.all.forEach((val, key, map) => {
      this.remotes.push(val);
    });
    this.h = new Heap({ comparBefore: (a: Transaction, b: Transaction) => a.gasPrice.gt(b.gasPrice) });
    for (let tx of this.remotes) {
      this.h.push(tx);
    }
  }
}
