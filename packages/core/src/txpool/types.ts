import { BN } from 'ethereumjs-util';
import { TxSortedMap } from './txmap';
import { Node } from '../node';

export interface TxPoolOptions {
  txMaxSize?: number;

  priceLimit?: BN;
  priceBump?: number;

  accountSlots?: number;
  globalSlots?: number;
  accountQueue?: number;
  globalQueue?: number;

  node: Node;

  journal?: string;
  lifetime?: number;
  timeoutInterval?: number;
  rejournalInterval?: number;
}

/**
 * TxPoolAccount contains pending, queued transaction and pending nonce of each account
 */
export class TxPoolAccount {
  private readonly getNonce: () => Promise<BN>;
  private _pending?: TxSortedMap;
  private _queue?: TxSortedMap;
  private _pendingNonce?: BN;
  timestamp: number = 0;

  constructor(getNonce: () => Promise<BN>) {
    this.getNonce = getNonce;
  }

  get pending() {
    return this._pending ? this._pending : (this._pending = new TxSortedMap(true));
  }

  get queue() {
    return this._queue ? this._queue : (this._queue = new TxSortedMap(false));
  }

  hasPending() {
    return this._pending && this._pending.size > 0;
  }

  hasQueue() {
    return this._queue && this._queue.size > 0;
  }

  async getPendingNonce() {
    if (!this._pendingNonce) {
      this._pendingNonce = await this.getNonce();
    }
    return this._pendingNonce.clone();
  }

  updatePendingNonce(nonce: BN, lower: boolean = false) {
    if (!this._pendingNonce || (lower ? this._pendingNonce.gt(nonce) : this._pendingNonce.lt(nonce))) {
      this._pendingNonce = nonce.clone();
    }
  }
}
