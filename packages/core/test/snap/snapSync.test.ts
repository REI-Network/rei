import crypto from 'crypto';
import { expect } from 'chai';
import { Database } from '@rei-network/database';
import { snapAccountKey, snapStorageKey, SNAP_ACCOUNT_PREFIX, SNAP_STORAGE_PREFIX } from '@rei-network/database/dist/constants';
import { Common } from '@rei-network/common';
import { FunctionalBufferMap, getRandomIntInclusive } from '@rei-network/utils';
import { StakingAccount } from '../../src/stateManager';
import { asyncTraverseRawDB } from '../../src/snap/layerIterator';
import { SnapSync, SnapSyncNetworkManager, SnapSyncPeer, AccountRequest, AccountResponse, StorageRequst, StorageResponse, PeerType } from '../../src/snap/snapSync';
import { genRandomAccounts, GenRandomAccountsResult } from './util';
import { BaseTrie } from 'merkle-patricia-tree';
const level = require('level-mem');

const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);

const maxAccountSize = 13;
const maxStorageSize = 13;

class MockPeer implements SnapSyncPeer {
  private readonly db: Database;
  private readonly result: GenRandomAccountsResult;

  private manager!: MockNetworkManager;

  private workStatus: Map<string, boolean>;

  constructor(db: Database, result: GenRandomAccountsResult) {
    this.db = db;
    this.result = result;

    this.workStatus = new Map<PeerType, boolean>([
      ['account', false],
      ['storage', false],
      ['code', false],
      ['trieNode', false]
    ]);
  }

  private async runWithLock<T>(type: PeerType, cb: () => Promise<T>) {
    const working = this.workStatus.get(type)!;
    if (working) {
      throw new Error(type + ' is working');
    }

    this.workStatus.set(type, true);
    const result = await cb();
    this.workStatus.set(type, false);

    // put back to pool
    this.manager.putBackIdlePeer(type, this);

    return result;
  }

  init(manager: MockNetworkManager) {
    this.manager = manager;
  }

  getAccountRange(root: Buffer, req: AccountRequest): Promise<AccountResponse | null> {
    return this.runWithLock('account', async () => {
      if (!root.equals(this.result.root)) {
        return null;
      }

      const hashes: Buffer[] = [];
      const accounts: StakingAccount[] = [];
      let cont = false;

      for await (const { hash, getValue } of asyncTraverseRawDB(
        this.db.rawdb,
        { gte: snapAccountKey(req.origin), lte: snapAccountKey(req.limit) },
        (key) => key.length !== SNAP_ACCOUNT_PREFIX.length + 32,
        (key) => key.slice(SNAP_ACCOUNT_PREFIX.length),
        (val) => StakingAccount.fromRlpSerializedAccount(val)
      )) {
        if (hashes.length >= maxAccountSize) {
          cont = true;
          break;
        }

        hashes.push(hash);
        accounts.push(getValue());
      }

      return { hashes, accounts, cont };
    });
  }

  getStorageRanges(root: Buffer, req: StorageRequst): Promise<StorageResponse | null> {
    return this.runWithLock('storage', async () => {
      if (!root.equals(this.result.root)) {
        return null;
      }

      const hashes: Buffer[][] = [];
      const slots: Buffer[][] = [];
      let len = 0;
      let cont = false;

      // large state task
      for (const account of req.accounts) {
        const _hashes: Buffer[] = [];
        const _slots: Buffer[] = [];

        for await (const { hash, getValue } of asyncTraverseRawDB(
          this.db.rawdb,
          { gte: snapStorageKey(account, req.origin), lte: snapStorageKey(account, req.limit) },
          (key) => key.length !== SNAP_STORAGE_PREFIX.length + 32 + 32,
          (key) => key.slice(SNAP_STORAGE_PREFIX.length + 32),
          (val) => val
        )) {
          if (len >= maxStorageSize) {
            cont = true;
            break;
          }

          _hashes.push(hash);
          _slots.push(getValue());
          len++;
        }

        hashes.push(_hashes);
        slots.push(_slots);

        if (len >= maxStorageSize) {
          break;
        }
      }

      return { hashes, slots, cont };
    });
  }

  getByteCodes(root: Buffer, hashes: Buffer[]): Promise<Buffer[] | null> {
    return this.runWithLock('code', () => {
      if (!root.equals(this.result.root)) {
        return Promise.resolve(null);
      }

      return Promise.all(hashes.map((hash) => this.db.rawdb.get(hash, { keyEncoding: 'binary', valueEncoding: 'binary' })));
    });
  }

  getTrieNodes(hashes: Buffer[]) {
    return this.runWithLock('trieNode', () => {
      return Promise.all(hashes.map((hash) => this.db.rawdb.get(hash, { keyEncoding: 'binary', valueEncoding: 'binary' })));
    });
  }
}

class PeerPool {
  private readonly pool: Set<MockPeer>;

  constructor(peers: MockPeer[]) {
    this.pool = new Set<MockPeer>(peers);
  }

  pick() {
    const peers = Array.from(this.pool.values());
    const peer = peers.length > 0 ? peers[getRandomIntInclusive(0, peers.length - 1)] : null;
    peer && this.pool.delete(peer);
    return peer;
  }

  add(peer: MockPeer) {
    this.pool.add(peer);
  }
}

class MockNetworkManager implements SnapSyncNetworkManager {
  private readonly pools: Map<PeerType, PeerPool>;

  constructor(peers: MockPeer[]) {
    this.pools = new Map<PeerType, PeerPool>([
      ['account', new PeerPool(peers)],
      ['storage', new PeerPool(peers)],
      ['code', new PeerPool(peers)],
      ['trieNode', new PeerPool(peers)]
    ]);
    peers.forEach((p) => p.init(this));
  }

  getIdlePeer(type: PeerType): SnapSyncPeer | null {
    return this.pools.get(type)!.pick();
  }

  putBackIdlePeer(type: PeerType, peer: SnapSyncPeer) {
    this.pools.get(type)!.add(peer as MockPeer);
  }
}

describe('SnapSync', () => {
  const srcDB = new Database(level(), common);
  let result!: GenRandomAccountsResult;
  let manager!: MockNetworkManager;

  async function checkSnap(dstDB: Database) {
    for (const info of result.accounts) {
      const srcSnapAccount = await srcDB.getSerializedSnapAccount(info.accountHash);
      const dstSnapAccount = await dstDB.getSerializedSnapAccount(info.accountHash);
      expect(srcSnapAccount.equals(dstSnapAccount), 'account should be equal').be.true;

      const srcCode = await srcDB.rawdb.get(info.account.codeHash, { keyEncoding: 'binary', valueEncoding: 'binary' });
      const dstCode = await dstDB.rawdb.get(info.account.codeHash, { keyEncoding: 'binary', valueEncoding: 'binary' });
      expect(srcCode.equals(dstCode), 'code should be equal').be.true;

      for (const [storageHash, { val }] of info.storageData.entries()) {
        const srcSnapStorage = await srcDB.getSnapStorage(info.accountHash, storageHash);
        const dstSnapStorage = await dstDB.getSnapStorage(info.accountHash, storageHash);
        expect(srcSnapStorage.equals(val), 'storage should be equal').be.true;
        expect(srcSnapStorage.equals(dstSnapStorage), 'storage should be equal').be.true;
      }
    }
  }

  before(async () => {
    result = await genRandomAccounts(srcDB, 30, 30, true);

    const peers: MockPeer[] = [];
    for (let i = 0; i < 20; i++) {
      peers.push(new MockPeer(srcDB, result));
    }
    manager = new MockNetworkManager(peers);
  });

  it('should sync succeed', async () => {
    const dstDB = new Database(level(), common);

    const sync = new SnapSync(dstDB, manager);
    await sync.setRoot(result.root);
    sync.start();
    await sync.waitUntilFinished();

    await checkSnap(dstDB);
  });

  it('should sync succeed(abort and resume)', async () => {
    const dstDB = new Database(level(), common);

    const sync = new SnapSync(dstDB, manager);
    await sync.setRoot(result.root);
    sync.start();

    await new Promise((r) => setTimeout(r, 100));
    await sync.abort();

    await sync.setRoot(result.root);
    sync.start();
    await sync.waitUntilFinished();

    await checkSnap(dstDB);
  });

  it('should sync succeed(gap)', async () => {
    // put some value in srcTrie
    const srcTrie = new BaseTrie(srcDB.rawdb, result.root);
    const gap = new FunctionalBufferMap<Buffer>();
    for (let i = 0; i < 10; i++) {
      const key = crypto.randomBytes(32);
      const value = crypto.randomBytes(32);
      gap.set(key, value);
      await srcTrie.put(key, value);
    }
    result.root = srcTrie.root;

    const dstDB = new Database(level(), common);

    const sync = new SnapSync(dstDB, manager);
    await sync.setRoot(result.root);
    sync.start();
    await sync.waitUntilFinished();

    await checkSnap(dstDB);

    // make sure all gaps exist
    const dstTrie = new BaseTrie(dstDB.rawdb, result.root);
    for (const [key, value] of gap) {
      const _value = await dstTrie.get(key);
      expect(_value && _value.equals(value), 'value should be equal').be.true;
    }
  });
});
