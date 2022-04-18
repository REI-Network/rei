import { LevelUp } from 'levelup';
import { bufferToHex, toBuffer, BN, setLengthLeft, KECCAK256_NULL, KECCAK256_RLP } from 'ethereumjs-util';
import { BaseTrie, CheckpointTrie } from 'merkle-patricia-tree';
import { logger, Channel, FunctionalBufferMap, FunctionalBufferSet } from '@rei-network/utils';
import { Database, DBOp, DBSaveSerializedSnapAccount, DBSaveSnapStorage, DBSaveSnapSyncProgress } from '@rei-network/database';
import { StakingAccount } from '../stateManager';
import { EMPTY_HASH, MAX_HASH } from '../utils';
import { increaseKey } from './utils';
import { BinaryRawDBatch, DBatch } from './batch';

const maxHashBN = new BN(MAX_HASH);

const accountConcurrency = 16;
const storageConcurrency = 16;

const storageRequestSize = 200000;
const codeRequestSize = 50;

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

export type AccountRequest = {
  origin: Buffer;
  limit: Buffer;
};

export type AccountResponse = {
  hashes: Buffer[];
  accounts: StakingAccount[];

  cont: boolean;
};

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
   * Initialize
   * @param db - Raw db
   */
  init(db: LevelUp) {
    this.genTrie = new CheckpointTrie(db);
    this.genTrie.checkpoint();

    // init state tasks
    for (const tasks of this.largeStateTasks.values()) {
      for (const task of tasks) {
        task.init(db);
      }
    }
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

export type StorageRequst = {
  accounts: Buffer[];
  roots: Buffer[];

  origin: Buffer;
  limit: Buffer;
};

export type StorageResponse = {
  hashes: Buffer[][];
  slots: Buffer[][];

  cont: boolean;
};

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
   * Initialize
   * @param db - Raw db
   */
  init(db: LevelUp) {
    this.genTrie = new CheckpointTrie(db);
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

type SnapSyncProgressJSON = {
  tasks: AccountTaskJSON[];
};

export interface SnapSyncPeer {
  getAccountRange(root: Buffer, req: AccountRequest): Promise<AccountResponse | null>;
  getStorageRanges(root: Buffer, req: StorageRequst): Promise<StorageResponse | null>;
  getByteCodes(root: Buffer, hashes: Buffer[]): Promise<Buffer[] | null>;
  getTrieNodes(hashes: Buffer[]): Promise<Buffer[] | null>;
}

export type PeerType = 'account' | 'storage' | 'code' | 'trieNode';

export interface SnapSyncNetworkManager {
  getIdlePeer(type: PeerType): SnapSyncPeer | null;
  putBackIdlePeer(type: PeerType, peer: SnapSyncPeer);
}

export class SnapSync {
  readonly db: Database;
  readonly root: Buffer;
  readonly network: SnapSyncNetworkManager;

  private readonly channel = new Channel<void | null | (() => Promise<void>)>();

  tasks: AccountTask[] = [];
  snapped: boolean = false;

  schedulePromise?: Promise<void>;

  constructor(db: Database, root: Buffer, network: SnapSyncNetworkManager) {
    this.db = db;
    this.root = root;
    this.network = network;
  }

  get isWorking() {
    return !!this.schedulePromise;
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

    tasks.forEach((task) => task.init(this.db.rawdb));

    this.tasks = tasks;
    this.snapped = tasks.length === 0;
  }

  /**
   * Save tasks in the database in JSON format
   */
  private async saveSyncProgress() {
    try {
      for (const task of this.tasks) {
        await task.genTrie.commit();
        for (const stateTasks of task.largeStateTasks.values()) {
          for (const stateTask of stateTasks) {
            await stateTask.genTrie.commit();
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

      peer.getAccountRange(this.root, req).then((res) => {
        this.channel.push(this.processAccountResponse.bind(this, task, res));
      });

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

      peer.getStorageRanges(this.root, req).then((res) => {
        this.channel.push(this.processStorageResponse.bind(this, task, largeStateTask, req, res));
      });

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

          const largeStateTasks: StorageTask[] = [];
          for (const [next, last] of splitRange(storageConcurrency, lastKey)) {
            const largeStateTask = new StorageTask(root, next, last);
            largeStateTask.init(this.db.rawdb);
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
          stateTask.genTrie.put(res.hashes[i][j], res.slots[i][j]);
        }
      }

      // save snapshot
      const batch: DBOp[] = [];
      for (let j = 0; j < res.hashes[i].length; j++) {
        batch.push(DBSaveSnapStorage(account, res.hashes[i][j], res.slots[i][j]));
      }
      await this.db.batch(batch);
    }

    // if the larget state task is done, commit it
    if (stateTask && stateTask.done) {
      await stateTask.genTrie.commit();
      if (stateTask.genTrie.root.equals(stateTask.root)) {
        // if the chunk's root is an overflown but full delivery, clear the heal request
        const account = req.accounts[req.accounts.length - 1];
        for (let i = 0; i < accountTask.res!.hashes.length; i++) {
          if (account.equals(accountTask.res!.hashes[i])) {
            accountTask.needHeal[i] = false;
          }
        }
      } else {
        logger.debug('SnapSync::processStorageResponse, state task committed but root does not match');
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

      peer.getByteCodes(this.root, hashes).then((res) => {
        this.channel.push(this.processBytecodeResponse.bind(this, task, hashes, res));
      });
    }
  }

  /**
   * Process bytecode response
   * @param task - Account task
   * @param hashes - Code hash list
   * @param res - Codes or null(if the request fails or times out)
   */
  private async processBytecodeResponse(task: AccountTask, hashes: Buffer[], res: Buffer[] | null) {
    // revert
    if (res === null) {
      hashes.forEach((hash) => task.pendingCode.add(hash));
      return;
    }

    const batch = new BinaryRawDBatch(this.db.rawdb);

    for (let i = 0; i < hashes.length; i++) {
      const hash = hashes[i];

      // reschedule the undelivered code
      if (i >= res.length) {
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
    batch.reset();

    if (task.pending === 0) {
      await this.forwardAccoutTask(task);
    }
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
    batch.reset();

    for (let i = 0; i < res.hashes.length; i++) {
      if (task.needCode[i] || task.needState[i]) {
        return;
      }

      task.next = increaseKey(res.hashes[i])!;
    }
    task.done = !res.cont;

    if (task.done) {
      await task.genTrie.commit();
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
    for await (const cb of this.channel) {
      try {
        if (cb) {
          // if callback exists, execute the callback
          await cb();
        } else if (cb === null) {
          // null means break
          break;
        } else {
          // otherwise, it might just be a peer join event, do nothing
        }

        await this.cleanStorageTasks();
        this.cleanAccountTasks();
        if (this.snapped) {
          // TODO: heal.pending
          break;
        }

        this.assignAccountTasks();
        this.assignBytecodeTasks();
        this.assignStorageTasks();

        if (this.snapped) {
          // TODO: heal logic
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
  }

  /**
   * Initialize
   */
  async init() {
    await this.loadSyncProgress();
    if (this.snapped) {
      // TODO: heal.pending
      logger.debug('SnapSync::init, already completed');
    }
  }

  /**
   * Start scheduling
   */
  start() {
    if (this.isWorking) {
      throw new Error('snap sync is working');
    }

    this.schedulePromise = this.scheduleLoop();

    // put an empty value to start scheduling
    this.channel.push();
  }

  /**
   * Stop scheduling
   */
  async abort() {
    if (!this.isWorking) {
      throw new Error("snap sync isn't working");
    }

    // clear queue
    this.channel.clear();
    // put a null value to stop scheduling
    this.channel.push(null);

    await this.schedulePromise;
    this.schedulePromise = undefined;
  }

  /**
   * Wait until snap sync finished(only for test)
   */
  waitUntilFinished() {
    if (!this.isWorking) {
      throw new Error("snap sync isn't working");
    }

    return this.schedulePromise;
  }
}
