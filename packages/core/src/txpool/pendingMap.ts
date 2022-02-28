import Heap from 'qheap';
import { Transaction } from '@rei-network/structure';
import { FunctionalBufferMap } from '@rei-network/utils';

/**
 * PendingTxMap record pending transactions
 */
export class PendingTxMap {
  private heap = new Heap({ comparBefore: (a: Transaction, b: Transaction) => a.gasPrice.gt(b.gasPrice) });
  private txs = new FunctionalBufferMap<Transaction[]>();

  /**
   * Push record to the map
   * @param sender - Transaction sender
   * @param sortedTxs - Transactions sorted by nonce
   */
  push(sender: Buffer, sortedTxs: Transaction[]) {
    if (sortedTxs.length > 0) {
      this.heap.push(sortedTxs.slice(0, 1)[0]);
      if (sortedTxs.length > 1) {
        this.txs.set(sender, sortedTxs.slice(1));
      }
    }
  }

  /**
   * Return the value at the top of the heap
   * @returns Transaction
   */
  peek(): Transaction | undefined {
    return this.heap.peek();
  }

  /**
   * Delete the value at the top of the heap, if
   * the transaction sender has other transactions in the map,
   * push first to the heap, else delete the sender from map
   */
  shift() {
    const tx: Transaction | undefined = this.heap.remove();
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

  /**
   * Removes a value from the top of the heap, and returns that value
   */
  pop() {
    this.heap.remove();
  }
}
