import { BN, Address, bufferToHex } from 'ethereumjs-util';
import Semaphore from 'semaphore-async-await';
import Heap from 'qheap';
import { FunctionalBufferMap, FunctionalBufferSet, Aborter, logger, InitializerWithEventEmitter } from '@rei-network/utils';
import { Transaction, BlockHeader, Block } from '@rei-network/structure';
import { Node } from '../node';
import { getGasLimitByCommon } from '../utils';
import { StateManager } from '../stateManager';
import { TxSortedMap } from './txmap';
import { PendingTxMap } from './pendingMap';
import { TxPricedList } from './txPricedList';
import { Journal } from './journal';
import { TxPoolAccount, TxPoolOptions } from './types';
import { txSlots, checkTxIntrinsicGas } from './utils';
import { isEnableFreeStaking } from '../hardforks';
import { validateTx } from '../validation';
import { Fee } from '../consensus/reimint/contracts';

const defaultTxMaxSize = 32768 * 4;
const defaultPriceLimit = new BN(1);
const defaultPriceBump = 10;
const defaultAccountSlots = 16;
const defaultGlobalSlots = 4096;
const defaultAccountQueue = 64;
const defaultGlobalQueue = 1024;
const defaultLifeTime = 1000 * 60 * 60 * 3; // 3 hours
const defaultTimeoutInterval = 1000 * 60; // 1 minutes
const defaultRejournalInterval = 1000 * 60 * 60; // 1 hours

export declare interface TxPool {
  on(event: 'readies', listener: (readies: Transaction[]) => void): this;

  off(event: 'readies', listener: (readies: Transaction[]) => void): this;
}

/**
 * TxPool contains all currently known transactions.
 */
export class TxPool extends InitializerWithEventEmitter {
  private readonly node: Node;
  private readonly aborter: Aborter;
  private readonly accounts = new FunctionalBufferMap<TxPoolAccount>();
  private readonly locals = new FunctionalBufferSet();
  private readonly txs = new FunctionalBufferMap<Transaction>();
  private readonly lock = new Semaphore(1);

  private rejournalLoopPromise?: Promise<void>;

  private currentHeader!: BlockHeader;
  private currentStateManager!: StateManager;

  private txMaxSize: number;

  private priceLimit: BN;
  private priceBump: number;

  private accountSlots: number;
  private globalSlots: number;
  private accountQueue: number;
  private globalQueue: number;
  private globalAllSlots: number;

  private priced: TxPricedList;
  private journal?: Journal;
  private lifetime: number;
  private timeoutInterval: number;
  private rejournalInterval: number;

  private totalAmount?: BN;

  constructor(options: TxPoolOptions) {
    super();
    this.txMaxSize = options.txMaxSize ?? defaultTxMaxSize;
    this.priceLimit = options.priceLimit ?? defaultPriceLimit;
    this.priceBump = options.priceBump ?? defaultPriceBump;
    this.accountSlots = options.accountSlots ?? defaultAccountSlots;
    this.globalSlots = options.globalSlots ?? defaultGlobalSlots;
    this.accountQueue = options.accountQueue ?? defaultAccountQueue;
    this.globalQueue = options.globalQueue ?? defaultGlobalQueue;
    this.globalAllSlots = 0;
    this.lifetime = options.lifetime ?? defaultLifeTime;
    this.timeoutInterval = options.timeoutInterval ?? defaultTimeoutInterval;
    this.rejournalInterval = options.rejournalInterval ?? defaultRejournalInterval;

    this.node = options.node;
    this.aborter = options.node.aborter;
    this.priced = new TxPricedList(this.txs);
    for (const buf of this.node.accMngr.totalUnlockedAccounts()) {
      this.locals.add(buf);
    }
    if (options.journal) {
      this.journal = new Journal(options.journal, this.node);
    }
  }

  private async runWithLock<T>(fn: () => Promise<T>) {
    try {
      await this.lock.acquire();
      return await fn();
    } catch (err) {
      throw err;
    } finally {
      this.lock.release();
    }
  }

  private local(): Map<Buffer, Transaction[]> {
    const txs = new FunctionalBufferMap<Transaction[]>();
    for (const addrBuf of this.locals) {
      const account = this.accounts.get(addrBuf);
      if (account?.hasPending()) {
        const transactions = txs.get(addrBuf);
        if (transactions) {
          const listtxs = account.pending.toList();
          for (const tx of listtxs) {
            transactions.push(tx as Transaction);
          }
        } else {
          txs.set(addrBuf, account.pending.toList());
        }
      }
      if (account?.hasQueue()) {
        const transactions = txs.get(addrBuf);
        if (transactions) {
          const listtxs = account.queue.toList();
          for (const tx of listtxs) {
            transactions.push(tx as Transaction);
          }
        } else {
          txs.set(addrBuf, account.queue.toList());
        }
      }
    }
    return txs;
  }

  /**
   * A loop to remove timeout queued transaction
   */
  private async timeoutLoop() {
    await this.initPromise;
    while (!this.aborter.isAborted) {
      await this.aborter.abortablePromise(new Promise((r) => setTimeout(r, this.timeoutInterval)));
      if (this.aborter.isAborted) {
        break;
      }
      for (const [addr, account] of this.accounts) {
        if (account.hasQueue() && Date.now() - account.timestamp > this.lifetime) {
          const queue = account.queue.clear();
          this.removeTxFromGlobal(queue);
        }
      }
    }
  }

  /**
   * A loop to rejournal transaction to disk
   */
  private async rejournalLoop() {
    await this.initPromise;
    while (!this.aborter.isAborted) {
      await this.aborter.abortablePromise(new Promise((r) => setTimeout(r, this.rejournalInterval)));
      if (this.aborter.isAborted) {
        break;
      }
      await this.journal!.rotate(this.local());
    }
  }

  private emitReadies(readies?: Map<Buffer, Transaction[]>) {
    if (readies) {
      let txs: Transaction[] = [];
      for (const list of readies.values()) {
        txs = txs.concat(list);
      }
      this.emit('readies', txs);
    }
  }

  /**
   * Initialize tx pool
   */
  async init(block: Block) {
    this.currentHeader = block.header;
    this.currentStateManager = await this.node.getStateManager(this.currentHeader.stateRoot, this.currentHeader._common);

    if (isEnableFreeStaking(this.currentHeader._common)) {
      this.totalAmount = await Fee.getTotalAmount(this.currentStateManager);
    } else {
      this.totalAmount = undefined;
    }

    if (this.journal) {
      await this.journal.load(async (txs: Transaction[]) => {
        let news: Transaction[] = [];
        for (const tx of txs) {
          if (this.txs.has(tx.hash())) {
            continue;
          }
          if (!tx.isSigned()) {
            continue;
          }
          news.push(tx);
        }
        if (news.length == 0) {
          return;
        }
        await this.node.addPendingTxs(news);
      });
    }
    this.initOver();
  }

  /**
   * Start tx pool
   */
  start() {
    this.initPromise.then(() => {
      this.timeoutLoop();
      if (this.journal) {
        this.rejournalLoopPromise = this.rejournalLoop();
      }
    });
  }

  async abort() {
    if (this.rejournalLoopPromise) {
      await this.rejournalLoopPromise;
    }
  }

  private getAccount(addr: Address): TxPoolAccount {
    const sender = addr.buf;
    let account = this.accounts.get(sender);
    if (!account) {
      account = new TxPoolAccount(async () => {
        return (await this.currentStateManager.getAccount(addr)).nonce;
      });
      this.accounts.set(sender, account);
    }
    return account;
  }

  /**
   * This should be called when canonical chain changes
   * It will update pending and queued transactions for each account with new block
   * @param newBlock - New block
   */
  async newBlock(newBlock: Block) {
    await this.initPromise;
    return await this.runWithLock(async () => {
      try {
        const originalNewBlock = newBlock;
        let oldBlock = await this.node.db.getBlockByHashAndNumber(this.currentHeader.hash(), this.currentHeader.number);
        let discarded: Transaction[] = [];
        const included = new FunctionalBufferSet();
        while (oldBlock.header.number.gt(newBlock.header.number)) {
          discarded = discarded.concat(oldBlock.transactions as Transaction[]);
          oldBlock = await this.node.db.getBlockByHashAndNumber(oldBlock.header.parentHash, oldBlock.header.number.subn(1));
        }
        while (newBlock.header.number.gt(oldBlock.header.number)) {
          for (const tx of newBlock.transactions) {
            included.add(tx.hash());
          }
          newBlock = await this.node.db.getBlockByHashAndNumber(newBlock.header.parentHash, newBlock.header.number.subn(1));
        }
        while (!oldBlock.hash().equals(newBlock.hash()) && oldBlock.header.number.gtn(0) && newBlock.header.number.gtn(0)) {
          discarded = discarded.concat(oldBlock.transactions as Transaction[]);
          oldBlock = await this.node.db.getBlockByHashAndNumber(oldBlock.header.parentHash, oldBlock.header.number.subn(1));
          for (const tx of newBlock.transactions) {
            included.add(tx.hash());
          }
          newBlock = await this.node.db.getBlockByHashAndNumber(newBlock.header.parentHash, newBlock.header.number.subn(1));
        }
        if (!oldBlock.hash().equals(newBlock.hash())) {
          throw new Error('reorg failed');
        }
        let reinject: Transaction[] = [];
        for (const tx of discarded) {
          if (!included.has(tx.hash())) {
            reinject.push(tx);
          }
        }
        this.currentHeader = originalNewBlock.header;
        this.currentStateManager = await this.node.getStateManager(this.currentHeader.stateRoot, this.currentHeader._common);

        if (isEnableFreeStaking(this.currentHeader._common)) {
          this.totalAmount = await Fee.getTotalAmount(this.currentStateManager);
        } else {
          this.totalAmount = undefined;
        }

        const reinjectAccounts = new FunctionalBufferMap<TxPoolAccount>();
        const getAccount = (addr: Address) => {
          let account = reinjectAccounts.get(addr.buf);
          if (!account) {
            account = this.getAccount(addr);
            reinjectAccounts.set(addr.buf, account);
          }
          return account;
        };
        for (const reinjectTx of reinject) {
          const account = getAccount(reinjectTx.getSenderAddress());
          account.updatePendingNonce(reinjectTx.nonce, true);
        }
        for (const account of reinjectAccounts.values()) {
          if (account.hasPending()) {
            const requeue = account.pending.back(await account.getPendingNonce());
            requeue.forEach((tx) => this.removeTxFromGlobal(tx));
            reinject = reinject.concat(requeue);
          }
        }
        this.emitReadies((await this._addTxs(reinject, true)).readies);
        await this.demoteUnexecutables();
        this.truncatePending();
        this.truncateQueue();
      } catch (err) {
        logger.error('TxPool::newBlock, catch error:', err);
      }
    });
  }

  /**
   * Add the transactions to the transaction pool
   * @param txs - Transactions
   * @returns A boolean array represents the insertion result of each transaction
   */
  async addTxs(txs: Transaction | Transaction[]) {
    await this.initPromise;
    return await this.runWithLock(async () => {
      txs = Array.isArray(txs) ? txs : [txs];
      try {
        const result = await this._addTxs(txs, false);
        this.emitReadies(result.readies);
        this.truncatePending();
        this.truncateQueue();
        return result;
      } catch (err) {
        logger.error('TxPool::addTxs, catch error:', err);
        return { results: new Array<boolean>(txs.length).fill(false) };
      }
    });
  }

  /**
   * Get all pending transactions in the pool
   * @returns A PendingTxMap object
   */
  async getPendingTxMap(number: BN, hash: Buffer) {
    await this.initPromise;
    return await this.runWithLock(async () => {
      if (!number.eq(this.currentHeader.number) || !hash.equals(this.currentHeader.hash())) {
        // TODO: fix this condition
        return undefined;
      }
      const pendingMap = new PendingTxMap();
      for (const [sender, account] of this.accounts) {
        if (!account.hasPending()) {
          continue;
        }
        pendingMap.push(sender, account.pending.toList());
      }
      return pendingMap;
    });
  }

  /**
   * Get all pending transaction hashes
   * @returns The array of hashes
   */
  getPooledTransactionHashes() {
    let hashes: Buffer[] = [];
    for (const [sender, account] of this.accounts) {
      if (!account.hasPending()) {
        continue;
      }
      hashes = hashes.concat(account.pending.toList().map((tx) => tx.hash()));
    }
    return hashes;
  }

  /**
   * Get transaction by hash
   * @param hash - Transaction hash
   * @returns Transaction
   */
  getTransaction(hash: Buffer) {
    return this.txs.get(hash);
  }

  /**
   * Get total pool content(for txpool api)
   * @returns An object containing all transactions in the pool
   */
  getPoolContent() {
    const result: { pending: { [address: string]: { [nonce: string]: any } }; queued: { [address: string]: { [nonce: string]: any } } } = { pending: {}, queued: {} };
    function forceGet<T>(obj: { [name: string]: T }, name: string) {
      let val = obj[name];
      if (val === undefined) {
        val = {} as any;
        Object.defineProperty(obj, name, { value: val, enumerable: true });
      }
      return val;
    }
    for (const [sender, account] of this.accounts) {
      const address = bufferToHex(sender);
      if (account.hasPending()) {
        const pendingObj = forceGet(result.pending, address);
        for (const [nonce, tx] of account.pending.nonceToTx) {
          const txObj = forceGet(pendingObj, nonce.toString());
          const txInfo = tx.toRPCJSON();
          for (const property in txInfo) {
            Object.defineProperty(txObj, property, { value: txInfo[property], enumerable: true });
          }
        }
      }
      if (account.hasQueue()) {
        const queuedObj = forceGet(result.queued, address);
        for (const [nonce, tx] of account.queue.nonceToTx) {
          const txObj = forceGet(queuedObj, nonce.toString());
          const txInfo = tx.toRPCJSON();
          for (const property in txInfo) {
            Object.defineProperty(txObj, property, { value: txInfo[property], enumerable: true });
          }
        }
      }
    }
    return result;
  }

  private async _addTxs(txs: Transaction[], force: boolean): Promise<{ results: boolean[]; readies?: Map<Buffer, Transaction[]> }> {
    const dirtyAddrs: Address[] = [];
    const results: boolean[] = [];
    for (const tx of txs) {
      if (this.txs.has(tx.hash())) {
        results.push(false);
        continue;
      }
      const addr = tx.getSenderAddress();
      if (!(await this.validateTx(tx))) {
        results.push(false);
        continue;
      }
      // drop tx if pool is full
      if (txSlots(tx) + this.txs.size > this.globalSlots + this.globalQueue) {
        if (this.priced.underpriced(tx)) {
          results.push(false);
          continue;
        }
        const [drop, success] = this.priced.discard(this.globalAllSlots - (this.globalSlots + this.globalQueue), true);
        if (!success) {
          results.push(false);
          continue;
        }
        if (drop) {
          for (const tx of drop) {
            this.removeTxFromGlobal(tx);
            const account = this.accounts.get(addr.buf);
            if (account?.hasPending()) {
              account.pending.delete(tx.nonce);
            }
            if (account?.hasQueue()) {
              account.queue.delete(tx.nonce);
            }
          }
        }
      }
      const account = this.getAccount(addr);
      if (account.hasPending() && account.pending.has(tx.nonce)) {
        this.promoteTx(tx);
      } else {
        if (this.enqueueTx(tx)) {
          dirtyAddrs.push(addr);
        }
      }
      this.globalAllSlots += txSlots(tx);
      // journalTx
      if (this.journal && this.locals.has(addr.toBuffer())) {
        await this.journal.insert(tx);
      }
      results.push(true);
    }
    const flag = results.reduce((a, b) => a || b, false);
    if (flag && !force && dirtyAddrs.length > 0) {
      return { results, readies: await this.promoteExecutables(dirtyAddrs) };
    } else if (force) {
      return { results, readies: await this.promoteExecutables() };
    } else {
      return { results };
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

  private async validateTx(tx: Transaction): Promise<boolean> {
    try {
      const txSize = tx.size;
      if (txSize > this.txMaxSize) {
        throw new Error(`size too large: ${txSize} max: ${this.txMaxSize}`);
      }
      if (!tx.isSigned()) {
        throw new Error('not signed');
      }
      const limit = getGasLimitByCommon(this.node.getLatestCommon());
      if (limit.lt(tx.gasLimit)) {
        throw new Error(`each block gasLimit: ${tx.gasLimit.toString()} limit: ${limit.toString()}`);
      }
      const senderAddr = tx.getSenderAddress();
      const sender = senderAddr.buf;
      if (!this.locals.has(sender) && tx.gasPrice.lt(this.priceLimit)) {
        throw new Error(`gasPrice too low: ${tx.gasPrice.toString()} limit: ${this.priceLimit.toString()}`);
      }

      // estimate next block's timestamp
      const period: number = this.currentHeader._common.consensusConfig().period;
      const currentTimestamp = this.currentHeader.timestamp.toNumber();

      // validate transaction
      await validateTx(tx as Transaction, currentTimestamp + period, this.currentStateManager, this.totalAmount);

      if (!checkTxIntrinsicGas(tx)) {
        throw new Error('checkTxIntrinsicGas failed');
      }
      return true;
    } catch (err) {
      logger.warn('Txpool drop tx', bufferToHex(tx.hash()), 'validateTx failed:', err);
      return false;
    }
  }

  private enqueueTx(tx: Transaction): boolean {
    const account = this.getAccount(tx.getSenderAddress());
    const { inserted, old } = account.queue.push(tx, this.priceBump);
    if (inserted) {
      this.txs.set(tx.hash(), tx);
    }
    if (old) {
      this.removeTxFromGlobal(old);
    }
    account.timestamp = Date.now();
    return inserted;
  }

  private promoteTx(tx: Transaction): boolean {
    const account = this.getAccount(tx.getSenderAddress());
    const { inserted, old } = account.pending.push(tx, this.priceBump);
    if (inserted) {
      this.txs.set(tx.hash(), tx);
    }
    if (old) {
      this.removeTxFromGlobal(old);
    }
    account.updatePendingNonce(tx.nonce.addn(1));
    account.timestamp = Date.now();
    return inserted;
  }

  private async promoteExecutables(dirtyAddrs?: Address[]): Promise<Map<Buffer, Transaction[]>> {
    const promoteAccount = async (sender: Buffer, account: TxPoolAccount): Promise<Transaction[]> => {
      let readies: Transaction[] = [];
      if (!account.hasQueue()) {
        return readies;
      }
      const queue = account.queue;
      const accountInDB = await this.currentStateManager.getAccount(new Address(sender));
      const forwards = queue.forward(accountInDB.nonce);
      this.removeTxFromGlobal(forwards);
      let dropsLength = 0;
      if (!isEnableFreeStaking(this.currentHeader._common)) {
        const { removed: drops } = queue.filter(accountInDB.balance, this.currentHeader.gasLimit);
        this.removeTxFromGlobal(drops);
        dropsLength = drops.length;
      }
      const totalReadies = queue.ready(await account.getPendingNonce());
      for (const tx of totalReadies) {
        if (this.promoteTx(tx)) {
          readies.push(tx);
        }
      }
      let resizesNumber = 0;
      if (!this.locals.has(sender)) {
        const resizes = queue.resize(this.accountQueue);
        resizesNumber = resizes.length;
        this.removeTxFromGlobal(resizes);
      }
      // resize priced
      this.priced.removed(forwards.length + dropsLength + resizesNumber);
      if (!account.hasQueue() && !account.hasPending()) {
        this.accounts.delete(sender);
      }
      return readies;
    };

    const txs = new FunctionalBufferMap<Transaction[]>();
    if (dirtyAddrs) {
      for (const addr of dirtyAddrs) {
        const account = this.getAccount(addr);
        const readies = await promoteAccount(addr.buf, account);
        if (readies.length > 0) {
          txs.set(addr.buf, readies);
        }
      }
    } else {
      for (const [sender, account] of this.accounts) {
        const readies = await promoteAccount(sender, account);
        if (readies.length > 0) {
          txs.set(sender, readies);
        }
      }
    }
    return txs;
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
      let dropsLength = 0;
      if (!isEnableFreeStaking(this.currentHeader._common)) {
        const { removed: drops, invalids } = pending.filter(accountInDB.balance, this.currentHeader.gasLimit);
        this.removeTxFromGlobal(drops);
        dropsLength = drops.length;
        for (const tx of invalids) {
          this.enqueueTx(tx);
        }
      }
      // resize priced
      this.priced.removed(forwards.length + dropsLength);
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
        pendingSlots += account.pending.slots;
      }
    }
    if (pendingSlots <= this.globalSlots) {
      return;
    }

    const heap = new Heap({ comparBefore: (a: TxPoolAccount, b: TxPoolAccount) => a.pending.slots > b.pending.slots });
    for (const [sender, account] of this.accounts) {
      if (account.hasPending() && account.pending.slots > this.accountSlots) {
        heap.push(account);
      }
    }

    const removeSingleTx = (account: TxPoolAccount) => {
      const pending = account.pending;
      const [tx] = pending.resize(pending.size - 1);
      this.removeTxFromGlobal(tx);
      account.updatePendingNonce(tx.nonce, true);
      // resize priced
      this.priced.removed([tx].length);
      pendingSlots -= txSlots(tx);
    };

    const offenders: TxPoolAccount[] = [];
    while (pendingSlots > this.globalSlots && heap.length > 0) {
      const offender: TxPoolAccount = heap.remove();
      offenders.push(offender);
      if (offenders.length > 1) {
        const threshold = offender.pending.slots;
        while (pendingSlots > this.globalSlots && offenders[offenders.length - 2].pending.slots > threshold) {
          for (let i = 0; i < offenders.length - 1; i++) {
            removeSingleTx(offenders[i]);
          }
        }
      }
    }

    if (pendingSlots > this.globalSlots && offenders.length > 0) {
      while (pendingSlots > this.globalSlots && offenders[offenders.length - 1].pending.slots > this.accountSlots) {
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
        queueSlots += account.queue.slots;
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
      if (queueSlots - queue.slots >= this.globalQueue) {
        queueSlots -= queue.slots;
        // resize priced
        const resizes = queue.clear();
        this.removeTxFromGlobal(resizes);
        this.priced.removed(resizes.length);
      } else {
        while (queueSlots > this.globalQueue) {
          const [tx] = queue.resize(queue.size - 1);
          this.removeTxFromGlobal(tx);
          // resize priced
          this.priced.removed(1);
          queueSlots -= txSlots(tx);
        }
        break;
      }
      account = heap.remove();
    }
  }

  /**
   * List the state of the tx-pool
   */
  async ls() {
    const info = (map: TxSortedMap, description: string) => {
      logger.info(`${description} size:`, map.size, '| slots:', map.slots);
      map.ls();
    };
    for (const [sender, account] of this.accounts) {
      logger.info('==========');
      logger.info('address: 0x' + sender.toString('hex'), '| timestamp:', account.timestamp, '| pendingNonce:', (await account.getPendingNonce()).toString());
      if (account.hasPending()) {
        info(account.pending, 'pending');
      }
      if (account.hasQueue()) {
        info(account.queue, 'queue');
      }
    }
  }
}

export { PendingTxMap, TxSortedMap };
