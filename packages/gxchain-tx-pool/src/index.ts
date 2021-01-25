import { BN } from 'ethereumjs-util';
import Heap from 'qheap';
import { Transaction } from '@gxchain2/tx';
import { FunctionalMap } from '@gxchain2/utils';

class TxSortedMap {
  private readonly strict: boolean;
  private readonly nonceToTx = new FunctionalMap<BN, Transaction>((a, b) => {
    if (a.lt(b)) {
      return -1;
    }
    if (a.gt(b)) {
      return 1;
    }
    return 0;
  });
  private nonceHeap: Heap;
  private sortedTxCache?: Transaction[];

  constructor(strict: boolean) {
    this.strict = strict;
    this.resetNonceHeap();
  }

  private resetNonceHeap(nonce?: BN[] | IterableIterator<BN>) {
    this.nonceHeap = new Heap((a: BN, b: BN) => a.lt(b));
    if (nonce) {
      for (const n of nonce) {
        this.nonceHeap.push(n);
      }
    }
  }

  get size() {
    return this.nonceToTx.size;
  }

  forward(nonce: BN) {
    const removed: Transaction[] = [];
    let nonceInHeap: BN = this.nonceHeap.peek();
    while (nonceInHeap && nonceInHeap.lt(nonce)) {
      const tx = this.nonceToTx.get(nonceInHeap)!;
      removed.push(tx);
      this.nonceToTx.delete(nonceInHeap);
      this.nonceHeap.remove();
      nonceInHeap = this.nonceHeap.peek();
    }
    return removed;
  }

  resize(size: number) {
    const removed: Transaction[] = [];
    if (this.size <= size) {
      return removed;
    }
    let keys = Array.from(this.nonceToTx.keys());
    while (keys.length > size && keys.length > 0) {
      const maxNonce = keys[keys.length - 1];
      removed.push(this.nonceToTx.get(maxNonce)!);
      this.nonceToTx.delete(maxNonce);
      keys.splice(keys.length - 1, 1);
    }
    this.resetNonceHeap(keys);
    return removed;
  }

  push(tx: Transaction): { inserted: boolean; old?: Transaction } {
    const nonce = tx.nonce;
    const old = this.nonceToTx.get(nonce);
    if (old) {
      // TODO: gasPrice
      if (old.gasPrice.gt(tx.gasPrice)) {
        return {
          inserted: false
        };
      }
    } else {
      this.nonceHeap.push(nonce);
    }
    this.nonceToTx.set(nonce, tx);
    return {
      inserted: true,
      old
    };
  }

  remove(nonce: BN): { deleted: boolean; invalids?: Transaction[] } {
    if (this.nonceToTx.has(nonce)) {
      this.nonceToTx.delete(nonce);
      const invalids: Transaction[] = [];
      if (this.strict) {
        const invalidKeys: BN[] = [];
        for (const [key, value] of this.nonceToTx) {
          if (key.gt(nonce)) {
            invalidKeys.push(key);
            invalids.push(value);
          }
        }
        for (const key of invalidKeys) {
          this.nonceToTx.delete(key);
        }
      }
      this.resetNonceHeap(this.nonceToTx.keys());
      return {
        deleted: true,
        invalids
      };
    }
    return {
      deleted: false
    };
  }
}
