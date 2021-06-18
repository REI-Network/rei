import Heap from 'qheap';
import { TypedTransaction } from '@gxchain2/structure';
import { createBufferFunctionalMap } from '@gxchain2/utils';

export class PendingTxMap {
  private heap = new Heap({ comparBefore: (a: TypedTransaction, b: TypedTransaction) => a.gasPrice.gt(b.gasPrice) });
  private txs = createBufferFunctionalMap<TypedTransaction[]>();

  push(sender: Buffer, sortedTxs: TypedTransaction[]) {
    if (sortedTxs.length > 0) {
      this.heap.push(sortedTxs.slice(0, 1)[0]);
      if (sortedTxs.length > 1) {
        this.txs.set(sender, sortedTxs.slice(1));
      }
    }
  }

  peek(): TypedTransaction | undefined {
    return this.heap.peek();
  }

  shift() {
    const tx: TypedTransaction | undefined = this.heap.remove();
    if (tx) {
      const sender = tx.getSenderAddress().buf;
      const nextTx = this.txs.get(sender);
      if (nextTx && nextTx.length > 0) {
        this.heap.push(nextTx.shift());
        if (nextTx?.length === 0) {
          this.txs.delete(sender);
        }
      }
    }
  }

  pop() {
    this.heap.remove();
  }
}
