import { BN, Address } from 'ethereumjs-util';
import { FunctionalMap } from '@gxchain2/utils';
import { Transaction } from '@gxchain2/tx';
import { StateManager } from '@gxchain2/state-manager';
import { Blockchain } from '@gxchain2/blockchain';
import { BlockHeader } from '@gxchain2/block';
import { TxSortedMap } from './txmap';

interface INode {
  blockchain: Blockchain;
  getStateManager(root: Buffer): Promise<StateManager>;
}

export interface TxPoolOptions {
  txMaxSize?: number;

  priceLimit?: number;
  priceBump?: number;

  accountSlots?: number;
  globalSlots?: number;
  accountQueue?: number;
  globalQueue?: number;

  node: INode;
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
    const pn = this._pendingNonce ? this._pendingNonce : (this._pendingNonce = new BN(0));
    return pn.clone();
  }

  hasPending() {
    return !!this._pending;
  }

  hasQueue() {
    return !!this._queue;
  }

  hasPendingNonce() {
    return !!this._pendingNonce;
  }

  updatePendingNonce(nonce: BN, force: boolean = false) {
    if (!this._pendingNonce || this._pendingNonce.lt(nonce) || force) {
      this._pendingNonce = nonce.clone();
    }
  }
}

export class TxPool {
  private readonly accounts: FunctionalMap<Buffer, TxPoolAccount>;
  private readonly txs: FunctionalMap<Buffer, Transaction>;
  private readonly options: TxPoolOptions;
  private readonly node: INode;
  private initPromise: Promise<void>;

  private currentHeader!: BlockHeader;
  private currentStateManager!: StateManager;

  constructor(options: TxPoolOptions) {
    this.options = options;
    this.node = options.node;
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

    this.initPromise = this.init();
  }

  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    this.currentHeader = this.node.blockchain.latestBlock.header;
    this.currentStateManager = await this.node.getStateManager(this.currentHeader.stateRoot);
  }

  addTx(tx: Transaction) {
    // validateTx
    // drop tx if pool is full
    const account = this.getAccount(tx.getSenderAddress().buf);
    if (account.hasPending() && account.pending.has(tx.nonce)) {
      this.promoteTx(tx);
    } else {
      this.enqueueTx(tx);
    }
  }

  private getAccount(sender: Buffer): TxPoolAccount {
    let account = this.accounts.get(sender);
    if (!account) {
      account = new TxPoolAccount();
      this.accounts.set(sender, account);
    }
    return account;
  }

  private enqueueTx(tx: Transaction): boolean {
    const account = this.getAccount(tx.getSenderAddress().buf);
    const { inserted, old } = account.queue.push(tx);
    if (old) {
      // removeTx
    }
    return inserted;
  }

  private promoteTx(tx: Transaction): boolean {
    const account = this.getAccount(tx.getSenderAddress().buf);
    const { inserted, old } = account.pending.push(tx);
    if (old) {
      // removeTx
    }
    account.updatePendingNonce(tx.nonce);
    account.timestamp = Date.now();
    return inserted;
  }

  private async promoteExecutables(dirtyAddrs?: Buffer[]) {
    if (dirtyAddrs) {
      for (const sender of dirtyAddrs) {
        const account = this.getAccount(sender);
        if (account.hasQueue()) {
          const accountInDB = await this.currentStateManager.getAccount(new Address(sender));
          const forwards = account.queue.forward(accountInDB.nonce);
          // removeTx
        }
      }
    }
  }
}
