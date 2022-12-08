import EventEmitter from 'events';
import { bufferToHex, toBuffer, BN, setLengthLeft, KECCAK256_NULL, KECCAK256_RLP } from 'ethereumjs-util';
import { BaseTrie, CheckpointTrie } from '@rei-network/trie';
import { logger, Channel, FunctionalBufferMap, FunctionalBufferSet } from '@rei-network/utils';
import { Database, DBSaveSerializedSnapAccount, DBSaveSnapStorage, DBSaveSnapSyncProgress } from '@rei-network/database';
import { StakingAccount } from '../../stateManager';
import { EMPTY_HASH, MAX_HASH, BinaryRawDBatch, DBatch, CountLock } from '../../utils';
import { increaseKey } from '../../snap/utils';
import { SyncInfo, PreInfo } from '../types';
import { TrieSync } from './trieSync';
import { AccountRequest, AccountResponse, StorageRequst, StorageResponse, SnapSyncNetworkManager } from './types';

const maxHashBN = new BN(MAX_HASH);

const accountConcurrency = 16;
const storageConcurrency = 16;

const storageRequestSize = 200000;
const codeRequestSize = 50;
const healTrieNodeRequestSize = 1024;
const healCodeRequestSize = 50;

function bnToBuffer32(bn: BN) {
  return setLengthLeft(bn.toBuffer(), 32);
}

/**
 * Divide the target account or status interval into segments
 * @param concurrency - Maximum allowed concurrency
 * @param from - Where to start dividing
 * @returns Segments
 */
function splitRange(concurrency: number, from: Buffer = EMPTY_HASH) {
  const fromBN = new BN(from);
  const remaining = maxHashBN.sub(fromBN);
  if (remaining.isNeg()) {
    throw new Error('from is greater than max hash');
  }

  // calucate a standard step
  let step = maxHashBN.divRound(new BN(concurrency));
  if (!fromBN.eqn(0)) {
    // if from is not 0, the step size and the number of concurrency need to be changed
    concurrency -= fromBN.div(step).toNumber();
    step = remaining.divn(concurrency);
  }

  const ranges: [Buffer, Buffer][] = [];
  let next = fromBN.eqn(0) ? fromBN : fromBN.addn(1);
  for (let i = 0; i < concurrency; i++) {
    const last = i === concurrency - 1 ? maxHashBN : next.add(step).subn(1);
    ranges.push([bnToBuffer32(next), bnToBuffer32(last)]);
    next = last.addn(1);
  }

  return ranges;
}

type LargeStateTasks = FunctionalBufferMap<StorageTask[]>;

type LargeStateTasksJSON = { [accoutHash: string]: StorageTaskJSON[] };

type AccountTaskJSON = {
  next: string;
  last: string;

  largeStateTasks: LargeStateTasksJSON;
};

class AccountTask {
  next: Buffer;
  last: Buffer;

  req?: AccountRequest;
  res?: AccountResponse;

  needCode: boolean[] = [];
  needState: boolean[] = [];
  needHeal: boolean[] = [];

  pending: number = 0;

  pendingCode = new FunctionalBufferSet();
  pendingState = new FunctionalBufferMap<Buffer>();

  largeStateTasks: LargeStateTasks;

  genTrie!: CheckpointTrie;

  done: boolean = false;

  constructor(next: Buffer, last: Buffer, largeStateTasks: LargeStateTasks = new FunctionalBufferMap<StorageTask[]>()) {
    this.next = next;
    this.last = last;
    this.largeStateTasks = largeStateTasks;
  }

  static fromJSON(json: AccountTaskJSON) {
    const largeStateTasks = new FunctionalBufferMap<StorageTask[]>();
    for (const [accountHash, tasks] of Object.entries(json.largeStateTasks)) {
      largeStateTasks.set(toBuffer(accountHash), tasks.map(StorageTask.fromJSON));
    }

    return new AccountTask(toBuffer(json.next), toBuffer(json.last), largeStateTasks);
  }

  /**
   * Flush data to disk
   */
  async commit() {
    await this.genTrie.commit();
    this.genTrie.checkpoint();
  }

  /**
   * Reset task information,
   * it will be called when a new response is received
   */
  reset() {
    const len = this.res?.accounts.length ?? 0;
    this.needCode = new Array<boolean>(len).fill(false);
    this.needState = new Array<boolean>(len).fill(false);
    this.needHeal = new Array<boolean>(len).fill(false);

    this.pending = 0;
    this.pendingCode.clear();
    this.pendingState.clear();
  }

  /**
   * Convert task to JSON format
   */
  toJSON(): AccountTaskJSON {
    const largeStateTasks: { [accoutHash: string]: StorageTaskJSON[] } = {};
    for (const [accountHash, tasks] of this.largeStateTasks) {
      largeStateTasks[bufferToHex(accountHash)] = tasks.map((task) => task.toJSON());
    }

    return {
      next: bufferToHex(this.next),
      last: bufferToHex(this.last),
      largeStateTasks
    };
  }
}

type StorageTaskJSON = {
  next: string;
  last: string;

  root: string;
};

class StorageTask {
  next: Buffer;
  last: Buffer;

  root: Buffer;

  req?: StorageRequst;
  res?: StorageResponse;

  genTrie!: CheckpointTrie;

  done: boolean = false;

  constructor(root: Buffer, next: Buffer, last: Buffer) {
    this.next = next;
    this.last = last;
    this.root = root;
  }

  static fromJSON(json: StorageTaskJSON) {
    return new StorageTask(toBuffer(json.root), toBuffer(json.next), toBuffer(json.last));
  }

  /**
   * Flush data to disk
   */
  async commit() {
    await this.genTrie.commit();
    this.genTrie.checkpoint();
  }

  /**
   * Convert task to JSON format
   */
  toJSON(): StorageTaskJSON {
    return {
      next: bufferToHex(this.next),
      last: bufferToHex(this.last),
      root: bufferToHex(this.root)
    };
  }
}

class HealTask {
  scheduler: TrieSync;

  pendingTrieNode = new FunctionalBufferSet();
  pendingCode = new FunctionalBufferSet();

  constructor(db: Database) {
    this.scheduler = new TrieSync(db);
  }

  /**
   * Clear heal task
   */
  clear() {
    this.scheduler.clear();
    this.pendingCode.clear();
    this.pendingTrieNode.clear();
  }
}

type SnapSyncProgressJSON = {
  tasks: AccountTaskJSON[];
};

export class SnapSync {
  readonly db: Database;
  readonly network: SnapSyncNetworkManager;
  readonly healer: HealTask;
  readonly lock = new CountLock();

  private readonly channel = new Channel<void | Buffer | (() => Promise<void>)>();

  root!: Buffer;
  tasks: AccountTask[] = [];
  snapped: boolean = false;
  finished: boolean = false;
  // true if first heal is done
  healed: boolean = false;
  testMode: boolean;
  onFinished?: () => void;

  private schedulePromise?: Promise<void>;

  constructor(db: Database, network: SnapSyncNetworkManager, testMode = false) {
    this.db = db;
    this.network = network;
    this.healer = new HealTask(db);
    this.testMode = testMode;
  }

  /**
   * Is it syncing
   */
  get isSyncing() {
    return !!this.schedulePromise;
  }

  /**
   * Run promise with lock
   * @param p - Promise
   * @returns Wrapped promise
   */
  private runWithLock<T>(p: Promise<T>): Promise<T> {
    this.lock.increase();
    return p.then((res) => {
      this.lock.decrease();
      return res;
    });
  }

  /**
   * Load tasks from database in JSON format
   */
  private async loadSyncProgress() {
    let tasks: AccountTask[] | undefined;

    const progress = await this.db.getSnapSyncProgress();
    if (progress) {
      try {
        tasks = (JSON.parse(progress.toString()) as SnapSyncProgressJSON).tasks.map(AccountTask.fromJSON);
      } catch (err) {
        logger.warn('SnapSync::loadSyncProgress, catch:', err);
      }
    }

    if (tasks === undefined) {
      tasks = [];
      for (const [next, last] of splitRange(accountConcurrency)) {
        tasks.push(new AccountTask(next, last));
      }
    }

    // initialize account genTrie
    const accountGenTrie = new CheckpointTrie(this.db.rawdb);
    accountGenTrie.checkpoint();
    for (const task of tasks) {
      task.genTrie = accountGenTrie;

      // initialize storage genTrie
      if (task.largeStateTasks.size > 0) {
        const storageGenTrie = new CheckpointTrie(this.db.rawdb);
        storageGenTrie.checkpoint();
        for (const stateTasks of task.largeStateTasks.values()) {
          for (const stateTask of stateTasks) {
            stateTask.genTrie = storageGenTrie;
          }
        }
      }
    }

    this.tasks = tasks;
    this.snapped = tasks.length === 0;
  }

  /**
   * Save tasks in the database in JSON format
   */
  private async saveSyncProgress() {
    try {
      for (const task of this.tasks) {
        await task.commit();
        for (const stateTasks of task.largeStateTasks.values()) {
          for (const stateTask of stateTasks) {
            await stateTask.commit();
          }
        }
      }
    } catch (err) {
      logger.warn('SnapSync::saveSyncProgress, catch:', err);
    }

    const json: SnapSyncProgressJSON = { tasks: this.tasks.map((task) => task.toJSON()) };
    await this.db.batch([DBSaveSnapSyncProgress(Buffer.from(JSON.stringify(json)))]);
  }

  /**
   * Assign account tasks to remote peers
   */
  private assignAccountTasks() {
    for (const task of this.tasks) {
      if (task.done || task.req !== undefined || task.res !== undefined) {
        continue;
      }

      const peer = this.network.getIdlePeer('account');
      if (peer === null) {
        return;
      }

      const req: AccountRequest = {
        origin: task.next,
        limit: task.last
      };

      this.runWithLock(
        peer.getAccountRange(this.root, req).then((res) => {
          this.channel.push(this.processAccountResponse.bind(this, task, res));
        })
      );

      task.req = req;
    }
  }

  /**
   * Process accoount response
   * @param task - Account task
   * @param res - Account response or null(if the request fails or times out)
   */
  private async processAccountResponse(task: AccountTask, res: AccountResponse | null) {
    // revert
    if (res === null) {
      task.req = undefined;
      return;
    }

    task.req = undefined;
    task.res = res;

    // ensure that the response doesn't overflow into the subsequent task
    for (let i = 0; i < res.hashes.length; i++) {
      const cmp = res.hashes[i].compare(task.last);
      if (cmp === 0) {
        res.cont = false;
        continue;
      }
      if (cmp > 0) {
        res.hashes = res.hashes.slice(0, i);
        res.accounts = res.accounts.slice(0, i);
        res.cont = false;
        break;
      }
    }

    // reset account task
    task.reset();

    // resumed is used to record the large state task that was woken up
    const resumed = new FunctionalBufferSet();

    for (let i = 0; i < res.accounts.length; i++) {
      const account = res.accounts[i];

      // check if the account is a contract with an unknown code
      if (!account.codeHash.equals(KECCAK256_NULL) && !(await this.db.hasCode(account.codeHash))) {
        task.needCode[i] = true;
        task.pendingCode.add(account.codeHash);
        task.pending++;
      }

      // check if the account is a contract with an unknown storage trie
      if (!account.stateRoot.equals(KECCAK256_RLP) && !(await this.db.hasTrieNode(account.stateRoot))) {
        const hash = res.hashes[i];
        // if the large state task exists, wake it up
        const largeStateTasks = task.largeStateTasks.get(hash);
        if (largeStateTasks !== undefined) {
          // the state root of the account may have changed when the large state task was awakened again
          largeStateTasks.forEach((task) => (task.root = account.stateRoot));
          // mark the task as needHeal
          task.needHeal[i] = true;
          resumed.add(hash);
        } else {
          // if the large state task doesn't exist, add it to the pending state task
          task.pendingState.set(res.hashes[i], account.stateRoot);
        }
        task.needState[i] = true;
        task.pending++;
      }
    }

    // delete all unawakened large state tasks
    for (const hash of task.largeStateTasks.keys()) {
      if (!resumed.has(hash)) {
        task.largeStateTasks.delete(hash);
      }
    }

    if (task.pending === 0) {
      await this.forwardAccoutTask(task);
    }
  }

  /**
   * Assign storage tasks to remote peers
   */
  private assignStorageTasks() {
    for (const task of this.tasks) {
      if (task.done || task.res === undefined) {
        continue;
      }

      if (task.largeStateTasks.size === 0 && task.pendingState.size === 0) {
        continue;
      }

      const peer = this.network.getIdlePeer('storage');
      if (peer === null) {
        return;
      }

      const accounts: Buffer[] = [];
      const roots: Buffer[] = [];
      let largeStateTask: StorageTask | undefined;

      // try to find a large state task
      for (const [accountHash, tasks] of task.largeStateTasks) {
        for (const stateTask of tasks) {
          if (stateTask.req !== undefined) {
            continue;
          }

          accounts.push(accountHash);
          roots.push(stateTask.root);
          largeStateTask = stateTask;
          break;
        }

        if (largeStateTask) {
          break;
        }
      }

      // if the large state task doesn't exsit, schedule pending state
      if (!largeStateTask) {
        for (const [accountHash, root] of task.pendingState) {
          task.pendingState.delete(accountHash);

          accounts.push(accountHash);
          roots.push(root);

          if (accounts.length >= storageRequestSize) {
            break;
          }
        }
      }

      if (accounts.length === 0) {
        // no tasks to process, put the peer back
        this.network.putBackIdlePeer('storage', peer);
        continue;
      }

      const req: StorageRequst = {
        accounts,
        roots,
        origin: largeStateTask?.next ?? EMPTY_HASH,
        limit: largeStateTask?.last ?? MAX_HASH
      };

      this.runWithLock(
        peer.getStorageRanges(this.root, req).then((res) => {
          this.channel.push(this.processStorageResponse.bind(this, task, largeStateTask, req, res));
        })
      );

      if (largeStateTask) {
        largeStateTask.req = req;
      }
    }
  }

  /**
   * Process storage response
   * @param accountTask - Account Task
   * @param stateTask - State task(if it is a large state task) or undefined
   * @param req - Storage request
   * @param res - Storage response or null(if the request fails or times out)
   */
  private async processStorageResponse(accountTask: AccountTask, stateTask: StorageTask | undefined, req: StorageRequst, res: StorageResponse | null) {
    // revert
    if (res === null) {
      if (stateTask) {
        // if the state task is a large state task, just clear the req
        stateTask.req = undefined;
      } else {
        // if the state task isn't a large state task, put the accounts and roots back in accountTask.pendingState
        for (let i = 0; i < req.accounts.length; i++) {
          accountTask.pendingState.set(req.accounts[i], req.roots[i]);
        }
      }
      return;
    }

    if (stateTask) {
      stateTask.req = undefined;
      stateTask.res = res;
    }

    for (let i = 0; i < req.accounts.length; i++) {
      const account = req.accounts[i];
      const root = req.roots[i];

      // reschedule the undelivered account
      if (i >= res.hashes.length) {
        accountTask.pendingState.set(account, req.roots[i]);
        continue;
      }

      const j = accountTask.res!.hashes.findIndex((hash) => hash.equals(account));
      if (j === -1) {
        logger.debug('SnapSync::processStorageResponse, missing account hash:', bufferToHex(account));
        continue;
      }

      // mark completed tasks
      if (stateTask === undefined && accountTask.needState[j] && (i < res.hashes.length - 1 || !res.cont)) {
        accountTask.needState[j] = false;
        accountTask.pending--;
      }

      // mark the task as needHeal
      if (stateTask === undefined && !accountTask.needHeal[j] && i === res.hashes.length - 1 && res.cont) {
        accountTask.needHeal[j] = true;
      }

      // if the last task is not completed, treat it as a large state task
      if (stateTask === undefined && i === res.hashes.length - 1 && res.cont) {
        if (accountTask.largeStateTasks.get(account) === undefined) {
          const keys = res.hashes[i];
          const lastKey = keys.length > 0 ? keys[keys.length - 1] : undefined;

          const storageGenTrie = new CheckpointTrie(this.db.rawdb);
          storageGenTrie.checkpoint();

          const largeStateTasks: StorageTask[] = [];
          for (const [next, last] of splitRange(storageConcurrency, lastKey)) {
            const largeStateTask = new StorageTask(root, next, last);
            largeStateTask.genTrie = storageGenTrie;
            largeStateTasks.push(largeStateTask);
          }

          accountTask.largeStateTasks.set(account, largeStateTasks);
          stateTask = largeStateTasks[0];
        }
      }

      if (stateTask) {
        // ensure the response doesn't overflow into the state task
        let keys = res.hashes[i];
        for (let k = 0; k < keys.length; k++) {
          const cmp = keys[k].compare(stateTask.last);
          if (cmp === 0) {
            res.cont = false;
            continue;
          }
          if (cmp > 0) {
            keys = keys.slice(0, k);
            res.hashes[i] = keys;
            res.slots[i] = res.slots[i].slice(0, k);
            res.cont = false;
            break;
          }
        }

        if (res.cont) {
          stateTask.next = increaseKey(keys[keys.length - 1])!;
        } else {
          stateTask.done = true;
        }
      }

      // directly put slots to disk for state task
      if (i < res.hashes.length - 1 || stateTask === undefined) {
        const trie = new BaseTrie(this.db.rawdb);
        for (let j = 0; j < res.hashes[i].length; j++) {
          await trie.put(res.hashes[i][j], res.slots[i][j]);
        }
      }

      // put slots to stateTask.genTrie(in memory) for large state task
      if (i === res.hashes.length - 1 && stateTask) {
        for (let j = 0; j < res.hashes[i].length; j++) {
          await stateTask.genTrie.put(res.hashes[i][j], res.slots[i][j]);
        }
      }

      // save snapshot
      const batch = new DBatch(this.db);
      for (let j = 0; j < res.hashes[i].length; j++) {
        batch.push(DBSaveSnapStorage(account, res.hashes[i][j], res.slots[i][j]));
      }
      await batch.write();
    }

    // if the larget state task is done, commit it
    if (stateTask && stateTask.done) {
      await stateTask.commit();
      if (stateTask.genTrie.root.equals(stateTask.root)) {
        // if the chunk's root is an overflown but full delivery, clear the heal request
        const account = req.accounts[req.accounts.length - 1];
        for (let i = 0; i < accountTask.res!.hashes.length; i++) {
          if (account.equals(accountTask.res!.hashes[i])) {
            accountTask.needHeal[i] = false;
          }
        }
      }
    }

    if (accountTask.pending === 0) {
      await this.forwardAccoutTask(accountTask);
    }
  }

  /**
   * Assign bytecode tasks to remote peers
   */
  private assignBytecodeTasks() {
    for (const task of this.tasks) {
      if (task.done || task.res === undefined) {
        continue;
      }

      if (task.pendingCode.size === 0) {
        continue;
      }

      const peer = this.network.getIdlePeer('code');
      if (peer === null) {
        return;
      }

      const hashes: Buffer[] = [];
      for (const hash of task.pendingCode) {
        hashes.push(hash);
        task.pendingCode.delete(hash);
        if (hashes.length >= codeRequestSize) {
          break;
        }
      }

      this.runWithLock(
        peer.getByteCodes(hashes).then((res) => {
          this.channel.push(this.processBytecodeResponse.bind(this, task, hashes, res));
        })
      );
    }
  }

  /**
   * Process bytecode response
   * @param task - Account task
   * @param hashes - Code hash list
   * @param res - Codes or null(if the request fails or times out)
   */
  private async processBytecodeResponse(task: AccountTask, hashes: Buffer[], res: (Buffer | undefined)[] | null) {
    // revert
    if (res === null) {
      hashes.forEach((hash) => task.pendingCode.add(hash));
      return;
    }

    const batch = new BinaryRawDBatch(this.db.rawdb);

    for (let i = 0; i < hashes.length; i++) {
      const hash = hashes[i];

      // reschedule the undelivered code
      if (i >= res.length || res[i] === undefined) {
        task.pendingCode.add(hash);
        continue;
      }

      for (let j = 0; j < task.res!.accounts.length; j++) {
        if (task.needCode[j] && hash.equals(task.res!.accounts[j].codeHash)) {
          task.needCode[j] = false;
          task.pending--;
        }
      }

      batch.push({ type: 'put', key: hash, value: res[i] });
    }

    await batch.write();

    if (task.pending === 0) {
      await this.forwardAccoutTask(task);
    }
  }

  /**
   * Load requests from trieSync to fill pending requests
   */
  private fillHealTask() {
    const have = this.healer.pendingTrieNode.size + this.healer.pendingCode.size;
    const want = healTrieNodeRequestSize + healCodeRequestSize;
    if (have < want) {
      const { nodeHashes, codeHashes } = this.healer.scheduler.missing(want - have);
      for (let i = 0; i < nodeHashes.length; i++) {
        this.healer.pendingTrieNode.add(nodeHashes[i]);
      }
      for (const codeHash of codeHashes) {
        this.healer.pendingCode.add(codeHash);
      }
    }
  }

  /**
   * Assign trie node tasks to remote peers
   */
  private assignHealTrieNodeTasks() {
    while (this.healer.pendingTrieNode.size > 0 || this.healer.scheduler.pending > 0) {
      this.fillHealTask();

      if (this.healer.pendingTrieNode.size === 0) {
        return;
      }

      const peer = this.network.getIdlePeer('trieNode');
      if (peer === null) {
        return;
      }

      const hashes: Buffer[] = [];
      for (const hash of this.healer.pendingTrieNode) {
        this.healer.pendingTrieNode.delete(hash);
        hashes.push(hash);
        if (hashes.length >= healTrieNodeRequestSize) {
          break;
        }
      }

      this.runWithLock(
        peer.getTrieNodes(hashes).then((res) => {
          this.channel.push(this.processHealTrieNodeResponse.bind(this, hashes, res));
        })
      );
    }
  }

  /**
   * Process heal trie node response
   * @param hashes - Node hash list
   * @param res - Nodes or null(if the request fails or times out)
   */
  private async processHealTrieNodeResponse(hashes: Buffer[], res: (Buffer | undefined)[] | null) {
    // revert
    if (res === null) {
      hashes.forEach((hash) => this.healer.pendingTrieNode.add(hash));
      return;
    }

    for (let i = 0; i < hashes.length; i++) {
      if (i >= res.length || res[i] === undefined) {
        this.healer.pendingTrieNode.add(hashes[i]);
        continue;
      }

      try {
        await this.healer.scheduler.process(hashes[i], res[i] as Buffer);
      } catch (err: any) {
        if (err.message === 'not found req') {
          // ignore missing request
        } else {
          logger.error('SnapSync::processHealTrieNodeResponse, catch:', err);
        }
      }
    }

    // flush data to disk
    const batch = new BinaryRawDBatch(this.db.rawdb);
    this.healer.scheduler.commit(batch);
    await batch.write();
  }

  /**
   * Assign bytecode tasks to remote peers
   */
  private assignHealBytecodeTasks() {
    while (this.healer.pendingCode.size > 0 || this.healer.scheduler.pending > 0) {
      this.fillHealTask();

      if (this.healer.pendingCode.size === 0) {
        return;
      }

      const peer = this.network.getIdlePeer('code');
      if (peer === null) {
        return;
      }

      const hashes: Buffer[] = [];
      for (const hash of this.healer.pendingCode) {
        hashes.push(hash); // delete?
        // this.healer.pendingCode.delete(hash);

        if (hashes.length >= healCodeRequestSize) {
          break;
        }
      }

      this.runWithLock(
        peer.getByteCodes(hashes).then((res) => {
          this.channel.push(this.processHealBytecodeResponse.bind(this, hashes, res));
        })
      );
    }
  }

  /**
   * Process heal bytecode response
   * @param hashes - Code hash list
   * @param res - Codes list or null(if the request fails or times out)
   */
  private async processHealBytecodeResponse(hashes: Buffer[], res: (Buffer | undefined)[] | null) {
    // revert
    if (res === null) {
      hashes.forEach((hash) => this.healer.pendingCode.add(hash));
      return;
    }

    for (let i = 0; i < hashes.length; i++) {
      if (i >= res.length || res[i] === undefined) {
        this.healer.pendingCode.add(hashes[i]);
        continue;
      }

      try {
        await this.healer.scheduler.process(hashes[i], res[i] as Buffer);
      } catch (err: any) {
        if (err.message === 'not found req') {
          // ignore missing request
        } else {
          logger.error('SnapSync::processHealBytecodeResponse, catch:', err);
        }
      }
    }

    // flush data to disk
    const batch = new BinaryRawDBatch(this.db.rawdb);
    this.healer.scheduler.commit(batch);
    await batch.write();
  }

  /**
   * Save snapshot to database and try to increase next hash of task
   * @param task - Account task
   */
  private async forwardAccoutTask(task: AccountTask) {
    const res = task.res;
    if (res === undefined) {
      return;
    }

    task.res = undefined;

    const batch = new DBatch(this.db);

    for (let i = 0; i < res.hashes.length; i++) {
      if (task.needCode[i] || task.needState[i]) {
        break;
      }

      const hash = res.hashes[i];
      const account = res.accounts[i];

      batch.push(DBSaveSerializedSnapAccount(hash, account.slimSerialize()));

      // if the task is complete, drop it into the stack trie to generate account trie nodes for it.
      // otherwise, it will be generated later in the heal phase
      if (!task.needHeal[i]) {
        await task.genTrie.put(hash, account.serialize());
      }
    }

    await batch.write();

    for (let i = 0; i < res.hashes.length; i++) {
      if (task.needCode[i] || task.needState[i]) {
        return;
      }

      task.next = increaseKey(res.hashes[i])!;
    }
    task.done = !res.cont;

    if (task.done) {
      await task.commit();
    }
  }

  /**
   * Clean finished account tasks
   */
  private cleanAccountTasks() {
    if (this.tasks.length === 0) {
      return;
    }

    this.tasks = this.tasks.filter((t) => !t.done);
    if (this.tasks.length === 0) {
      this.snapped = true;
    }
  }

  /**
   * Clean finished storage tasks
   */
  private async cleanStorageTasks() {
    for (const task of this.tasks) {
      for (const [account, stateTasks] of task.largeStateTasks) {
        const stateTasks2 = stateTasks.filter((t) => !t.done);
        if (stateTasks2.length > 0) {
          task.largeStateTasks.set(account, stateTasks2);
          continue;
        }

        for (let i = 0; i < (task.res?.hashes.length ?? 0); i++) {
          const hash = task.res!.hashes[i];
          if (hash.equals(account)) {
            task.needState[i] = false;
          }
        }

        task.largeStateTasks.delete(account);
        task.pending--;

        if (task.pending === 0) {
          await this.forwardAccoutTask(task);
        }
      }
    }
  }

  private async scheduleLoop() {
    let preRoot: Buffer | undefined = undefined;
    for await (const cb of this.channel) {
      try {
        if (cb instanceof Buffer) {
          preRoot = cb;
        } else if (cb) {
          // if callback exists, execute the callback
          await cb();
        } else {
          // otherwise, it might just be a peer join event, do nothing
        }

        await this.cleanStorageTasks();
        this.cleanAccountTasks();
        if (this.snapped && this.healer.scheduler.pending === 0) {
          if (this.testMode || this.healed) {
            // finished, break
            this.finished = true;
            // invoke hook
            this.onFinished && this.onFinished();
            this.onFinished = undefined;
            break;
          } else if (preRoot !== undefined) {
            this.healer.clear();
            await this.healer.scheduler.setRoot(preRoot);
            this.healed = true;
          }
        }

        // assign all the data retrieval tasks to any free peers
        this.assignAccountTasks();
        this.assignBytecodeTasks();
        this.assignStorageTasks();

        if (this.snapped) {
          // sync phase done, run heal phase
          this.assignHealTrieNodeTasks();
          this.assignHealBytecodeTasks();
        }
      } catch (err) {
        logger.error('SnapSync::scheduleLoop, catch:', err);
      }
    }

    try {
      for (const task of this.tasks) {
        await this.forwardAccoutTask(task);
      }

      this.cleanAccountTasks();
      await this.saveSyncProgress();
    } catch (err) {
      logger.error('SnapSync::scheduleLoop, catch(when exit):', err);
    }

    // wait for all requests to complete
    await this.lock.wait();

    // clear scheduler
    this.clear();
  }

  /**
   * Set sync root
   */
  async setRoot(root: Buffer) {
    this.root = root;
    await this.loadSyncProgress();
    await this.healer.scheduler.setRoot(this.root, async (paths, path, leaf, parent) => {
      // the leaf node is an account
      if (paths.length === 1) {
        try {
          const account = StakingAccount.fromRlpSerializedAccount(leaf);
          await this.db.batch([DBSaveSerializedSnapAccount(paths[0], account.slimSerialize())]);
        } catch (err) {
          // ignore invalid leaf node
        }
      }
      // the leaf node is a slot
      else if (paths.length === 2) {
        await this.db.batch([DBSaveSnapStorage(paths[0], paths[1], leaf)]);
      } else {
        logger.warn('SnapSync::setRoot, unknown leaf node');
      }
    });
  }

  /**
   * Start snap sync with remote peer
   * @param root
   */
  async snapSync(root: Buffer) {
    if (this.schedulePromise) {
      throw new Error('snap sync is working');
    }

    // set state root
    await this.setRoot(root);
    // reset channel
    this.channel.reset();
    // start loop
    this.schedulePromise = this.scheduleLoop().finally(() => {
      this.schedulePromise = undefined;
    });
    // put an empty value to start scheduling
    this.channel.push();
  }

  /**
   * Announce snapSync when a new peer joins
   */
  announce() {
    if (!this.isSyncing) {
      throw new Error("snap sync isn't working");
    }

    // put an empty value to announce coroutine
    this.channel.push();
  }

  announcePreRoot(root: Buffer) {
    if (!this.isSyncing) {
      throw new Error("snap sync isn't working");
    }

    // put an empty value to announce coroutine
    this.channel.push(root);
  }

  /**
   * Stop scheduling
   */
  async abort() {
    if (this.schedulePromise) {
      // abort queue
      this.channel.abort();
      // wait for loop to exit
      await this.schedulePromise;
    }
  }

  /**
   * Clear scheduler
   */
  clear() {
    this.healer.clear();
    this.root = undefined as any;
    this.tasks = [];
    this.snapped = false;
    this.finished = false;
    this.network.resetStatelessPeer();
  }

  /**
   * Wait until snap sync finished(only for test)
   */
  async wait() {
    if (this.schedulePromise) {
      await this.schedulePromise;
    }
  }
}

export declare interface SnapSyncScheduler {
  on(event: 'start', listener: (info: SyncInfo) => void): this;
  on(event: 'finished', listener: (info: SyncInfo) => void): this;
  on(event: 'synchronized', listener: (info: SyncInfo) => void): this;
  on(event: 'failed', listener: (info: SyncInfo) => void): this;

  off(event: 'start', listener: (info: SyncInfo) => void): this;
  off(event: 'finished', listener: (info: SyncInfo) => void): this;
  off(event: 'synchronized', listener: (info: SyncInfo) => void): this;
  off(event: 'failed', listener: (info: SyncInfo) => void): this;
}

export class SnapSyncScheduler extends EventEmitter {
  readonly syncer: SnapSync;
  // Todo
  // readonly downloader: SnapDownloader;

  private aborted: boolean = false;
  private onFinished?: () => Promise<void>;
  private syncPromise?: Promise<void>;
  private syncResolve?: () => void;

  // sync state
  private startingBlock: number = 0;
  private highestBlock: number = 0;

  constructor(syncer: SnapSync) {
    super();
    this.syncer = syncer;
  }

  /**
   * Get the sync state
   */
  get status() {
    return { startingBlock: this.startingBlock, highestBlock: this.highestBlock };
  }

  /**
   * Is it syncing
   */
  get isSyncing() {
    return !!this.syncPromise;
  }

  /**
   * Reset snap sync root and highest block number
   * @param height - Highest block number
   * @param root - New state root
   * @param onFinished - On finished callback
   */
  async resetRoot(height: number, root: Buffer, onFinished?: () => Promise<void>) {
    if (!this.aborted && this.syncer.root !== undefined && !this.syncer.root.equals(root)) {
      this.highestBlock = height;
      this.onFinished = onFinished;
      // abort and restart sync
      await this.syncer.abort();
      await this.syncer.snapSync(root);
    }
  }

  /**
   * Async start snap sync,
   * this function will not wait until snap sync finished
   * @param root - State root
   * @param startingBlock - Start sync block number
   * @param info - Sync info
   * @param onFinished - On finished callback,
   *                     it will be invoked when sync finished
   */
  async snapSync(root: Buffer, startingBlock: number, info: SyncInfo, onFinished?: () => Promise<void>) {
    if (this.isSyncing) {
      throw new Error('SnapSyncScheduler is working');
    }

    this.onFinished = onFinished;
    this.startingBlock = startingBlock;
    this.highestBlock = info.bestHeight.toNumber();
    // send events
    this.emit('start', info);

    // start snap sync
    await this.syncer.snapSync(root);
    // this.downloader.on('preRoot', (info: PreInfo) => {
    //   this.syncer.announcePreRoot(info.preRoot);
    // });
    // wait until finished
    this.syncPromise = new Promise<void>((resolve) => {
      this.syncResolve = resolve;
      this.syncer.onFinished = () => {
        resolve();
      };
    }).finally(async () => {
      this.syncPromise = undefined;
      this.syncResolve = undefined;
      if (!this.aborted) {
        // invoke callback if it exists
        this.onFinished && (await this.onFinished());
        // send events
        this.emit('finished', info);
        this.emit('synchronized', info);
      }
    });
  }

  /**
   * Abort sync
   */
  async abort() {
    this.aborted = true;
    this.syncResolve && this.syncResolve();
    await this.syncer.abort();
  }
}
