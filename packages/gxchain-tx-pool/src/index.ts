import { BN, Address } from 'ethereumjs-util';
import Heap from 'qheap';
import { FunctionalMap } from '@gxchain2/utils';
import { Transaction } from '@gxchain2/tx';
import { StateManager } from '@gxchain2/state-manager';
import { Blockchain } from '@gxchain2/blockchain';
import { BlockHeader, Block } from '@gxchain2/block';
import { Database } from '@gxchain2/database';
import { Common } from '@gxchain2/common';
import { TxSortedMap } from './txmap';

interface INode {
  db: Database;
  common: Common;
  blockchain: Blockchain;
  getStateManager(root: Buffer): Promise<StateManager>;
}

export function txSlots(tx: Transaction) {
  return Math.ceil(tx.size / 32768);
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
    return this._pending && this._pending.size > 0;
  }

  hasQueue() {
    return this._queue && this._queue.size > 0;
  }

  hasPendingNonce() {
    return !!this._pendingNonce;
  }

  updatePendingNonce(nonce: BN, lower: boolean = false) {
    if (!this._pendingNonce || (lower ? this._pendingNonce.gt(nonce) : this._pendingNonce.lt(nonce))) {
      this._pendingNonce = nonce.clone();
    }
  }
}

export class TxPool {
  private readonly accounts: FunctionalMap<Buffer, TxPoolAccount>;
  private readonly locals: FunctionalMap<Buffer, boolean>;
  private readonly txs: FunctionalMap<Buffer, Transaction>;

  private readonly node: INode;
  private initPromise: Promise<void>;

  private currentHeader!: BlockHeader;
  private currentStateManager!: StateManager;

  private txMaxSize: number;

  private priceLimit: number;
  private priceBump: number;

  private accountSlots: number;
  private globalSlots: number;
  private accountQueue: number;
  private globalQueue: number;

  constructor(options: TxPoolOptions) {
    this.txMaxSize = options.txMaxSize || 1000;
    this.priceLimit = options.priceLimit || 1;
    this.priceBump = options.priceBump || 10;
    this.accountSlots = options.accountSlots || 16;
    this.globalSlots = options.globalSlots || 4096;
    this.accountQueue = options.accountQueue || 64;
    this.globalQueue = options.globalQueue || 1024;

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
    this.locals = new FunctionalMap<Buffer, boolean>(bufferCompare);

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

  private getAccount(sender: Buffer): TxPoolAccount {
    let account = this.accounts.get(sender);
    if (!account) {
      account = new TxPoolAccount();
      this.accounts.set(sender, account);
    }
    return account;
  }

  async newBlock(newBlock: Block) {
    const getBlock = async (hash: Buffer, number: BN) => {
      const header = await this.node.db.getHeader(hash, number);
      const bodyBuffer = await this.node.db.getBody(hash, number);
      return Block.fromBlockData(
        {
          header: header,
          transactions: bodyBuffer[0].map((rawTx) => Transaction.fromValuesArray(rawTx, { common: this.node.common }))
        },
        { common: this.node.common }
      );
    };

    const originalNewBlock = newBlock;
    let oldBlock = await getBlock(this.currentHeader.hash(), this.currentHeader.number);
    let discarded: Transaction[] = [];
    const included = new FunctionalMap<Buffer, boolean>();
    while (oldBlock.header.number.gt(newBlock.header.number)) {
      discarded = discarded.concat(oldBlock.transactions);
      oldBlock = await getBlock(oldBlock.header.parentHash, oldBlock.header.number.subn(1));
    }
    while (newBlock.header.number.gt(oldBlock.header.number)) {
      for (const tx of newBlock.transactions) {
        included.set(tx.hash(), true);
      }
      newBlock = await getBlock(newBlock.header.parentHash, newBlock.header.number.subn(1));
    }
    while (!oldBlock.hash().equals(newBlock.hash())) {
      discarded = discarded.concat(oldBlock.transactions);
      oldBlock = await getBlock(oldBlock.header.parentHash, oldBlock.header.number.subn(1));
      for (const tx of newBlock.transactions) {
        included.set(tx.hash(), true);
      }
      newBlock = await getBlock(newBlock.header.parentHash, newBlock.header.number.subn(1));
    }
    const reinject: Transaction[] = [];
    for (const tx of discarded) {
      if (!included.has(tx.hash())) {
        reinject.push(tx);
      }
    }
    this.currentHeader = originalNewBlock.header;
    this.currentStateManager = await this.node.getStateManager(this.currentHeader.stateRoot);
    await this.addTx(reinject, true);
    await this.demoteUnexecutables();
    this.truncatePending();
    this.truncateQueue();
  }

  async addTx(txs: Transaction | Transaction[], force: boolean = false) {
    txs = txs instanceof Transaction ? [txs] : txs;
    const dirtyAddres: Buffer[] = [];
    for (const tx of txs) {
      // validateTx
      // drop tx if pool is full
      const sender = tx.getSenderAddress().buf;
      const account = this.getAccount(sender);
      if (account.hasPending() && account.pending.has(tx.nonce)) {
        this.promoteTx(tx);
      } else {
        this.enqueueTx(tx);
        dirtyAddres.push(sender);
      }
      // journalTx
    }
    if (!force && dirtyAddres.length > 0) {
      await this.promoteExecutables(dirtyAddres);
    } else if (force) {
      await this.promoteExecutables();
    }
  }

  private removeTxFromGlobal(key: Transaction | Transaction[]) {
    if (Array.isArray(key)) {
      for (const tx of key) {
        this.txs.delete(tx.hash());
      }
    } else {
      this.txs.delete(key.hash());
    }
  }

  private enqueueTx(tx: Transaction): boolean {
    const account = this.getAccount(tx.getSenderAddress().buf);
    const { inserted, old } = account.queue.push(tx);
    if (inserted) {
      this.txs.set(tx.hash(), tx);
    }
    if (old) {
      this.removeTxFromGlobal(old);
    }
    if (account.timestamp === 0) {
      account.timestamp = Date.now();
    }
    return inserted;
  }

  private promoteTx(tx: Transaction): boolean {
    const account = this.getAccount(tx.getSenderAddress().buf);
    const { inserted, old } = account.pending.push(tx);
    if (inserted) {
      this.txs.set(tx.hash(), tx);
    }
    if (old) {
      this.removeTxFromGlobal(old);
    }
    account.updatePendingNonce(tx.nonce);
    account.timestamp = Date.now();
    return inserted;
  }

  private async promoteExecutables(dirtyAddrs?: Buffer[]) {
    const promoteAccount = async (sender: Buffer, account: TxPoolAccount) => {
      if (!account.hasQueue()) {
        return;
      }
      const queue = account.queue;
      const accountInDB = await this.currentStateManager.getAccount(new Address(sender));
      const forwards = queue.forward(accountInDB.nonce);
      this.removeTxFromGlobal(forwards);
      const { removed: drops } = queue.filter(accountInDB.balance, this.currentHeader.gasLimit);
      this.removeTxFromGlobal(drops);
      const readies = queue.ready(account.pendingNonce);
      for (const tx of readies) {
        this.promoteTx(tx);
      }
      if (!this.locals.has(sender)) {
        const resizes = queue.resize(this.accountQueue);
        this.removeTxFromGlobal(resizes);
      }
      // resize priced
      if (!account.hasQueue() && !account.hasPending()) {
        this.accounts.delete(sender);
      }
    };

    if (dirtyAddrs) {
      for (const sender of dirtyAddrs) {
        const account = this.getAccount(sender);
        await promoteAccount(sender, account);
      }
    } else {
      for (const [sender, account] of this.accounts) {
        await promoteAccount(sender, account);
      }
    }
  }

  private async demoteUnexecutables() {
    for (const [sender, account] of this.accounts) {
      if (!account.hasPending()) {
        continue;
      }
      const pending = account.pending;
      const accountInDB = await this.currentStateManager.getAccount(new Address(sender));
      const forwards = pending.forward(accountInDB.nonce);
      this.removeTxFromGlobal(forwards);
      const { removed: drops, invalids } = pending.filter(accountInDB.balance, this.currentHeader.gasLimit);
      this.removeTxFromGlobal(drops);
      // resize priced
      for (const tx of invalids) {
        this.enqueueTx(tx);
      }
      if (!pending.has(accountInDB.nonce) && pending.size > 0) {
        const resizes = pending.resize(0);
        for (const tx of resizes) {
          this.enqueueTx(tx);
        }
      }
      if (!account.hasPending() && !account.hasQueue()) {
        this.accounts.delete(sender);
      }
    }
  }

  private truncatePending() {
    let pendingSlots = 0;
    for (const [sender, account] of this.accounts) {
      if (account.hasPending()) {
        pendingSlots += account.pending.size;
      }
    }
    if (pendingSlots <= this.globalSlots) {
      return;
    }

    const heap = new Heap({ comparBefore: (a: TxPoolAccount, b: TxPoolAccount) => a.pending.size > b.pending.size });
    for (const [sender, account] of this.accounts) {
      if (account.hasPending() && account.pending.size > this.accountSlots) {
        heap.push(account);
      }
    }

    const removeSingleTx = (account: TxPoolAccount) => {
      const pending = account.pending;
      const [tx] = pending.resize(pending.size - 1);
      this.removeTxFromGlobal(tx);
      account.updatePendingNonce(tx.nonce, true);
      // resize priced
      pendingSlots--;
    };

    const offenders: TxPoolAccount[] = [];
    while (pendingSlots > this.globalSlots && heap.size > 0) {
      const offender: TxPoolAccount = heap.remove();
      offenders.push(offender);
      if (offenders.length > 1) {
        const threshold = offender.pending.size;
        while (pendingSlots > this.globalSlots && offenders[offenders.length - 2].pending.size > threshold) {
          for (let i = 0; i < offenders.length - 1; i++) {
            removeSingleTx(offenders[i]);
          }
        }
      }
    }

    if (pendingSlots > this.globalSlots && offenders.length > 0) {
      while (pendingSlots > this.globalSlots && offenders[offenders.length - 1].pending.size > this.accountSlots) {
        for (const offender of offenders) {
          removeSingleTx(offender);
        }
      }
    }
  }

  private truncateQueue() {
    let queueSlots = 0;
    for (const [sender, account] of this.accounts) {
      if (account.hasQueue()) {
        queueSlots += account.queue.size;
      }
    }
    if (queueSlots <= this.globalQueue) {
      return;
    }

    const heap = new Heap({ comparBefore: (a: TxPoolAccount, b: TxPoolAccount) => a.timestamp < b.timestamp });
    for (const [sender, account] of this.accounts) {
      if (!this.locals.has(sender) && account.hasQueue()) {
        heap.push(account);
      }
    }

    let account: TxPoolAccount = heap.remove();
    while (queueSlots > this.globalQueue && account) {
      const queue = account.queue;
      if (queueSlots - queue.size >= this.globalQueue) {
        queueSlots -= queue.size;
        // resize priced
        this.removeTxFromGlobal(queue.clear());
      } else {
        while (queueSlots > this.globalQueue) {
          const [tx] = queue.resize(queue.size - 1);
          this.removeTxFromGlobal(tx);
          // resize priced
          queueSlots--;
        }
        break;
      }
      account = heap.remove();
    }
  }
}
