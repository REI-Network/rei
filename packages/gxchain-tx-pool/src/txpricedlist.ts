import { Transaction } from '@gxchain2/tx';

export class TxPricedList {
  stales: number;
  all: Map<Buffer, Buffer>;
  remotes: Transaction[];
  constructor(all: Map<Buffer, Buffer>, stales: number) {
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

  Cap(threshold: number) {}

  Underpriced(tx: Transaction) {}

  Discard(slot: number, force: Boolean) {}

  Reheap() {}
}
