import { LevelUp } from 'levelup';
import { bufferToHex, toBuffer, BN, setLengthLeft, KECCAK256_NULL, KECCAK256_RLP } from 'ethereumjs-util';
import { BaseTrie, CheckpointTrie } from 'merkle-patricia-tree';
import { logger, Channel, FunctionalBufferMap, FunctionalBufferSet } from '@rei-network/utils';
import { Database, DBOp, DBSaveSnapStorage, DBSaveSnapSyncProgress } from '@rei-network/database';
import { StakingAccount } from '../stateManager';
import { EMPTY_HASH, MAX_HASH } from '../utils';
import { increaseKey } from './utils';
import { BinaryRawDBatch } from './batch';

const maxHashBN = new BN(MAX_HASH);

const accountConcurrency = 16;
const storageConcurrency = 16;

const storageRequestSize = 200000;
const codeRequestSize = 50;

function bnToBuffer32(bn: BN) {
  return setLengthLeft(bn.toBuffer(), 32);
}

function splitRange(concurrency: number, from: Buffer = EMPTY_HASH) {
  const fromBN = new BN(from);
  const remaining = maxHashBN.sub(fromBN);
  if (remaining.isNeg()) {
    throw new Error('from is greater than max hash');
  }

  // calucate step
  let step = maxHashBN.divn(concurrency);
  if (!fromBN.eqn(0)) {
    concurrency -= fromBN.div(step).toNumber();
    step = remaining.divn(concurrency);
  }

  const ranges: [Buffer, Buffer][] = [];
  let next = fromBN.eqn(0) ? fromBN : fromBN.addn(1);
  for (let i = 0; i < concurrency; i++) {
    const last = i === concurrency - 1 ? maxHashBN : next.add(step);
    ranges.push([bnToBuffer32(next), bnToBuffer32(last)]);
    next = last.addn(1);
  }

  return ranges;
}

type AccountRequest = {
  origin: Buffer;
  limit: Buffer;
};

type AccountResponse = {
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

  done: boolean;
};

class AccountTask {
  next: Buffer;
  last: Buffer;

  req?: AccountRequest;
  res?: AccountResponse;

  needCode: boolean[] = [];
  needState: boolean[] = [];

  pending: number = 0;

  pendingCode = new FunctionalBufferSet();
  pendingState = new FunctionalBufferMap<Buffer>();

  largeStateTasks: LargeStateTasks;

  genTrie!: CheckpointTrie;

  done: boolean;

  constructor(next: Buffer, last: Buffer, largeStateTasks: LargeStateTasks = new FunctionalBufferMap<StorageTask[]>(), done: boolean = false) {
    this.next = next;
    this.last = last;
    this.largeStateTasks = largeStateTasks;
    this.done = done;
  }

  static fromJSON(json: AccountTaskJSON) {
    const largeStateTasks = new FunctionalBufferMap<StorageTask[]>();
    for (const [accountHash, tasks] of Object.entries(json.largeStateTasks)) {
      largeStateTasks.set(toBuffer(accountHash), tasks.map(StorageTask.fromJSON));
    }

    return new AccountTask(toBuffer(json.next), toBuffer(json.last), largeStateTasks, json.done);
  }

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

  reset() {
    const len = this.res?.accounts.length ?? 0;
    this.needCode = new Array<boolean>(len).fill(false);
    this.needState = new Array<boolean>(len).fill(false);

    this.pending = 0;
    this.pendingCode.clear();
    this.pendingState.clear();
  }

  async commit() {
    await this.genTrie.commit();
    this.genTrie.checkpoint();
  }

  toJSON(): AccountTaskJSON {
    const largeStateTasks: { [accoutHash: string]: StorageTaskJSON[] } = {};
    for (const [accountHash, tasks] of this.largeStateTasks) {
      largeStateTasks[bufferToHex(accountHash)] = tasks.map((task) => task.toJSON());
    }

    return {
      next: bufferToHex(this.next),
      last: bufferToHex(this.last),
      largeStateTasks,
      done: this.done
    };
  }
}

type StorageRequst = {
  accounts: Buffer[];
  roots: Buffer[];

  origin: Buffer;
  limit: Buffer;
};

type StorageResponse = {
  hashes: Buffer[][];
  slots: Buffer[][];

  cont: boolean;
};

type StorageTaskJSON = {
  next: string;
  last: string;

  root: string;

  done: boolean;
};

class StorageTask {
  next: Buffer;
  last: Buffer;

  root: Buffer;

  req?: StorageRequst;
  res?: StorageResponse;

  genTrie!: CheckpointTrie;

  done: boolean;

  constructor(root: Buffer, next: Buffer, last: Buffer, done: boolean = false) {
    this.next = next;
    this.last = last;
    this.root = root;
    this.done = done;
  }

  static fromJSON(json: StorageTaskJSON) {
    return new StorageTask(toBuffer(json.root), toBuffer(json.next), toBuffer(json.last), json.done);
  }

  init(db: LevelUp) {
    this.genTrie = new CheckpointTrie(db);
    this.genTrie.checkpoint();
  }

  async commit() {
    await this.genTrie.commit();
    this.genTrie.checkpoint();
  }

  toJSON(): StorageTaskJSON {
    return {
      next: bufferToHex(this.next),
      last: bufferToHex(this.last),
      root: bufferToHex(this.root),
      done: this.done
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

type PeerType = 'account' | 'storage' | 'code' | 'trieNode';

export interface SnapSyncNetworkManager {
  getIdlePeer(type: PeerType): SnapSyncPeer | null;
  putBackIdlePeer(type: PeerType, peer: SnapSyncPeer);
}

export class SnapSync {
  readonly db: Database;
  readonly root: Buffer;
  readonly network: SnapSyncNetworkManager;

  private readonly channel = new Channel<void | (() => Promise<void>)>({ max: 1 });

  tasks: AccountTask[] = [];

  constructor(db: Database, root: Buffer, network: SnapSyncNetworkManager) {
    this.db = db;
    this.root = root;
    this.network = network;
  }

  get snapped() {
    for (const task of this.tasks) {
      if (!task.done) {
        return false;
      }
    }

    return true;
  }

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
  }

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
          resumed.add(hash);
        } else {
          // if the large state task doesn't exist, add it to the pending state task
          task.pendingState.set(res.hashes[i], account.stateRoot);
        }
      }
    }

    // delete all unawakened large state tasks
    for (const hash of task.largeStateTasks.keys()) {
      if (!resumed.has(hash)) {
        task.largeStateTasks.delete(hash);
      }
    }

    if (task.pending === 0) {
      // TODO: forwardAccount
    }
  }

  private assignStorageTasks() {
    for (const task of this.tasks) {
      if (task.done || task.res === undefined) {
        continue;
      }

      if (task.largeStateTasks.size === 0 || task.pendingState.size === 0) {
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

      // if (largeStateTask === undefined && ) {
      // needHeal ??
      // }

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
      await stateTask.commit();
      if (!stateTask.genTrie.root.equals(stateTask.root)) {
        logger.debug('SnapSync::processStorageResponse, state task committed but root does not match');
      }
    }

    if (accountTask.pending === 0) {
      // TODO: forward account
    }
  }

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
        this.channel.push(this.processByteCodesResponse.bind(this, task, hashes, res));
      });
    }
  }

  private async processByteCodesResponse(task: AccountTask, hashes: Buffer[], res: Buffer[] | null) {
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
      // TODO: forwardAccount
    }
  }

  private async scheduleLoop() {
    for await (const fn of this.channel) {
    }
  }

  async init() {
    await this.loadSyncProgress();
    if (this.snapped) {
      // TODO: heal.pending
      logger.debug('SnapSync::init, already completed');
      return;
    }
  }
}
