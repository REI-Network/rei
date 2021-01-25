import { BN } from 'ethereumjs-util';
import { FunctionalMap } from '@gxchain2/utils';
import { Transaction } from '@gxchain2/tx';
import { TxSortedMap } from './txmap';

export interface TxPoolOptions {
  txMaxSize?: number;

  priceLimit?: number;
  priceBump?: number;

  accountSlots?: number;
  globalSlots?: number;
  accountQueue?: number;
  globalQueue?: number;
}

class TxPoolAccount {
  private _pending?: TxSortedMap;
  private _queue?: TxSortedMap;
  private _pendingNonce?: BN;
  timestamp: number = 0;

  get pending() {
    return this._pending ? this._pending : (this._pending = new TxSortedMap(true));
  }

  get queue() {
    return this._queue ? this._queue : (this._queue = new TxSortedMap(false));
  }

  get pendingNonce() {
    return this._pendingNonce ? this._pendingNonce : (this._pendingNonce = new BN(0));
  }
}

export class TxPool {
  private readonly accounts: FunctionalMap<Buffer, TxPoolAccount>;
  private readonly txs: FunctionalMap<Buffer, Transaction>;
  private readonly options: TxPoolOptions;

  constructor(options: TxPoolOptions) {
    this.options = options;
    const bufferCompare = (a: Buffer, b: Buffer) => {
      if (a.length < b.length) {
        return -1;
      }
      if (a.length > b.length) {
        return 1;
      }
      for (let i = 0; i < a.length; i++) {
        if (a[i] < b[i]) {
          return -1;
        }
        if (a[i] > b[i]) {
          return 1;
        }
      }
      return 0;
    };
    this.accounts = new FunctionalMap<Buffer, TxPoolAccount>(bufferCompare);
    this.txs = new FunctionalMap<Buffer, Transaction>(bufferCompare);
  }

  private enqueueTx(tx: Transaction): boolean {
    const sender = tx.getSenderAddress().buf;
    let account = this.accounts.get(sender);
    if (!account) {
      account = new TxPoolAccount();
      this.accounts.set(sender, account);
    }
    const { inserted, old } = account.queue.push(tx);
    if (old) {
      // removeTx
    }
    return inserted;
  }

  private promoteTx(tx: Transaction): boolean {
    const sender = tx.getSenderAddress().buf;
    let account = this.accounts.get(sender);
    if (!account) {
      account = new TxPoolAccount();
      this.accounts.set(sender, account);
    }
    const { inserted, old } = account.pending.push(tx);
    if (old) {
      // removeTx
    }
    return inserted;
  }
}
