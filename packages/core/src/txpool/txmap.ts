import { BN } from 'ethereumjs-util';
import Heap from 'qheap';
import { Transaction, WrappedTransaction } from '@gxchain2/structure';
import { logger, createBNFunctionalMap } from '@gxchain2/utils';
import { txSlots, txCost } from './index';

/**
 * txSortedMap is a nonce->transaction hash map with a heap based index to allow
 * iterating over the contents in a nonce-incrementing way.
 */
export class TxSortedMap {
  readonly nonceToTx = createBNFunctionalMap<Transaction>();
  private readonly strict: boolean;
  private nonceHeap: Heap;
  private sortedTxCache?: Transaction[];
  private _slots: number = 0;

  constructor(strict: boolean) {
    this.strict = strict;
    this.resetNonceHeap();
  }

  /**
   * Increase the slot of the map by given transactions
   * @param txs Given transactions
   */
  private increaseSlots(txs: Transaction | Transaction[]) {
    txs = Array.isArray(txs) ? txs : [txs];
    for (const tx of txs) {
      this._slots += txSlots(tx);
    }
  }

  /**
   * Decrease the slot of the map by given transactions
   * @param txs Given transactions
   */
  private decreaseSlots(txs: Transaction | Transaction[]) {
    txs = Array.isArray(txs) ? txs : [txs];
    for (const tx of txs) {
      this._slots -= txSlots(tx);
    }
    if (this._slots < 0) {
      this._slots = 0;
    }
  }

  /**
   * Reset nonceheap by given nonces
   * @param nonce Given nonces
   */
  private resetNonceHeap(nonce?: BN[] | IterableIterator<BN>) {
    this.nonceHeap = new Heap({ comparBefore: (a: BN, b: BN) => a.lt(b) });
    if (nonce) {
      for (const n of nonce) {
        this.nonceHeap.push(n);
      }
    }
  }

  /**
   * Strictly check transactions and delete transactions
   * with nonce greater than the threshold
   * @param nonce Threshold number
   * @param invalids Invalid transactions array
   */
  private strictCheck(nonce: BN, invalids: Transaction[]) {
    if (this.strict) {
      for (const [key, value] of this.nonceToTx) {
        if (value.nonce.gt(nonce)) {
          invalids.push(value);
          this.nonceToTx.delete(key);
        }
      }
    }
  }

  get size() {
    return this.nonceToTx.size;
  }

  get slots() {
    return this._slots;
  }

  has(nonce: BN) {
    return this.nonceToTx.has(nonce);
  }

  /**
   * back removes all transactions from the map with a nonce greater than or equal
   * with the provided threshold. Every removed transaction is returned for any
   * post-removl maintenance.
   * @param nonce threshold
   * @returns removed transactions
   */
  back(nonce: BN) {
    const removed: Transaction[] = [];
    let nonceInHeap: BN = this.nonceHeap.peek();
    while (nonceInHeap && nonceInHeap.gte(nonce)) {
      const tx = this.nonceToTx.get(nonceInHeap)!;
      removed.push(tx);
      this.nonceToTx.delete(nonceInHeap);
      this.nonceHeap.remove();
      nonceInHeap = this.nonceHeap.peek();
    }
    this.decreaseSlots(removed);
    if (this.sortedTxCache) {
      this.sortedTxCache.splice(0, removed.length);
    }
    return removed;
  }

  /**
   * Forward removes all transactions from the map with a nonce lower than the
   * provided threshold. Every removed transaction is returned for any post-removal
   * maintenance.
   * @param nonce threshold
   * @returns removed transactions
   */
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
    this.decreaseSlots(removed);
    if (this.sortedTxCache) {
      this.sortedTxCache.splice(0, removed.length);
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
    this.decreaseSlots(removed);
    if (this.sortedTxCache) {
      this.sortedTxCache.splice(this.sortedTxCache.length - removed.length, removed.length);
    }
    return removed;
  }

  /**
   * push tries to insert a new transaction into the map, returning whether the
   * transaction was accepted, and if yes, any previous transaction it replaced.
   * @param tx Inserted transaction
   * @param priceBump Markup threshold
   * @returns Inserted state and replaced transaction
   */
  push(tx: Transaction, priceBump: number): { inserted: boolean; old?: Transaction } {
    const nonce = tx.nonce;
    const old = this.nonceToTx.get(nonce);
    if (old) {
      if (tx.gasPrice.muln(100).lt(new BN(priceBump + 100).mul(old.gasPrice))) {
        return {
          inserted: false
        };
      }
      this.decreaseSlots(old);
    } else {
      this.nonceHeap.push(nonce);
    }
    this.nonceToTx.set(nonce, tx);
    this.increaseSlots(tx);
    this.sortedTxCache = undefined;
    return {
      inserted: true,
      old
    };
  }

  /**
   * Remove deletes a transaction from the maintained list, returning whether the
   * transaction was found, and also returning any transaction invalidated due to
   * the deletion.
   * @param nonce Transaction nonce
   * @returns Deleted state and invaild transactions
   */
  delete(nonce: BN): { deleted: boolean; invalids?: Transaction[] } {
    const removedTx = this.nonceToTx.get(nonce);
    if (removedTx) {
      this.nonceToTx.delete(nonce);
      const invalids: Transaction[] = [];
      this.strictCheck(nonce, invalids);
      this.resetNonceHeap(this.nonceToTx.keys());
      this.decreaseSlots(invalids.concat(removedTx));
      this.sortedTxCache = undefined;
      return {
        deleted: true,
        invalids
      };
    }
    return {
      deleted: false
    };
  }

  /**
   * Filter removes all transactions from the list with a cost or gas limit higher
   * than the provided thresholds. Every removed transaction is returned for any
   *  post-removal maintenance.
   * @param balance Cost threshold
   * @param gasLimit Gas limit threshold
   * @returns removed and invalid transactions
   */
  filter(balance: BN, gasLimit: BN): { removed: Transaction[]; invalids: Transaction[] } {
    let lowestNonce: BN | undefined;
    const removed: Transaction[] = [];
    for (const [key, value] of this.nonceToTx) {
      if (txCost(value).gt(balance) || value.gasLimit.gt(gasLimit)) {
        lowestNonce = lowestNonce ? (lowestNonce.gt(key) ? key : lowestNonce) : key;
        removed.push(value);
        this.nonceToTx.delete(key);
      }
    }
    const invalids: Transaction[] = [];
    if (lowestNonce) {
      this.strictCheck(lowestNonce, invalids);
    }
    this.decreaseSlots(invalids.concat(removed));
    this.sortedTxCache = undefined;
    return { removed, invalids };
  }

  /**
   * Ready retrieves a sequentially increasing list of transactions starting at the
   * provided nonce that is ready for processing.
   * @param start Start nonce
   * @returns Transactions removed from the list.
   */
  ready(start: BN): Transaction[] {
    const nonce = start.clone();
    const readies: Transaction[] = [];
    let nonceInHeap: BN = this.nonceHeap.peek();
    while (nonceInHeap && nonceInHeap.eq(nonce)) {
      readies.push(this.nonceToTx.get(nonceInHeap)!);
      this.nonceToTx.delete(nonceInHeap);
      this.nonceHeap.remove();
      nonce.iaddn(1);
      nonceInHeap = this.nonceHeap.peek();
    }
    this.decreaseSlots(readies);
    if (this.sortedTxCache) {
      this.sortedTxCache.splice(0, readies.length);
    }
    return readies;
  }

  /**
   * Clear the map and heap
   * @returns Removed transactions
   */
  clear(): Transaction[] {
    const removed = Array.from(this.nonceToTx.values());
    this.nonceToTx.clear();
    this.resetNonceHeap();
    this._slots = 0;
    this.sortedTxCache = undefined;
    return removed;
  }

  /**
   * toList creates a nonce-sorted slice of transactions,
   * copys nonceToTx
   * @returns
   */
  toList(): Transaction[] {
    if (this.sortedTxCache) {
      return this.sortedTxCache;
    }
    this.sortedTxCache = [];
    for (const [key, value] of this.nonceToTx) {
      this.sortedTxCache.push(value);
    }
    return this.sortedTxCache;
  }

  /**
   * List all transactions in map
   */
  ls() {
    for (const [key, value] of this.nonceToTx) {
      logger.info('---');
      logger.info(new WrappedTransaction(value).toRPCJSON());
    }
  }
}
