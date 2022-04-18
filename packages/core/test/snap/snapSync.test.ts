import { Database } from '@rei-network/database';
import { snapAccountKey, snapStorageKey, SNAP_ACCOUNT_PREFIX, SNAP_STORAGE_PREFIX } from '@rei-network/database/dist/constants';
import { Common } from '@rei-network/common';
import { getRandomIntInclusive } from '@rei-network/utils';
import { StakingAccount } from '../../src/stateManager';
import { asyncTraverseRawDB } from '../../src/snap/layerIterator';
import { SnapSync, SnapSyncNetworkManager, SnapSyncPeer, AccountRequest, AccountResponse, StorageRequst, StorageResponse, PeerType } from '../../src/snap/snapSync';
import { genRandomAccounts, GenRandomAccountsResult } from './util';
const level = require('level-mem');

const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);

class Accounts {
  root: Buffer;
  private readonly result: GenRandomAccountsResult;

  constructor(result: GenRandomAccountsResult) {
    this.root = result.root;
    this.result = result;
  }

  //   isLastestAccountHash(hash: Buffer) {
  //     return hash.equals(this.result.lastestAccountHash);
  //   }

  //   isLastestStorageHash(accountHash: Buffer, storageHash: Buffer) {
  //     for (const info of this.result.accounts) {
  //       if (info.accountHash.equals(accountHash)) {
  //         return info.lastestStorageHash.equals(storageHash);
  //       }
  //     }
  //     return false;
  //   }
}

class MockPeer implements SnapSyncPeer {
  private readonly db: Database;
  private readonly accounts: Accounts;

  private manager!: MockNetworkManager;

  private workStatus: Map<string, boolean>;

  constructor(accounts: Accounts, db: Database) {
    this.db = db;
    this.accounts = accounts;

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
      if (!root.equals(this.accounts.root)) {
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
        hashes.push(hash);
        accounts.push(getValue());
        // cont = this.accounts.isLastestAccountHash(hash);
      }

      return { hashes, accounts, cont };
    });
  }

  getStorageRanges(root: Buffer, req: StorageRequst): Promise<StorageResponse | null> {
    return this.runWithLock('storage', async () => {
      if (!root.equals(this.accounts.root)) {
        return null;
      }

      const hashes: Buffer[][] = [];
      const slots: Buffer[][] = [];
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
          _hashes.push(hash);
          _slots.push(getValue());
          //   cont = this.accounts.isLastestStorageHash(account, hash);
        }

        hashes.push(_hashes);
        slots.push(_slots);
      }

      return { hashes, slots, cont };
    });
  }

  getByteCodes(root: Buffer, hashes: Buffer[]): Promise<Buffer[] | null> {
    return this.runWithLock('code', () => {
      if (!root.equals(this.accounts.root)) {
        return Promise.resolve(null);
      }

      return Promise.all(hashes.map((hash) => this.db.rawdb.get(hash, { keyEncoding: 'binary', valueEncoding: 'binary' })));
    });
  }

  getTrieNodes(hashes: Buffer[]): Promise<Buffer[] | null> {
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
  const db = new Database(level(), common);
  const syncDB = new Database(level(), common);
  let accounts!: Accounts;
  let manager!: MockNetworkManager;

  before(async () => {
    const result = await genRandomAccounts(db, 100, 10, true);
    accounts = new Accounts(result);

    const peers: MockPeer[] = [];
    for (let i = 0; i < 20; i++) {
      peers.push(new MockPeer(accounts, db));
    }
    manager = new MockNetworkManager(peers);
  });

  it('should sync succeed', async () => {
    const sync = new SnapSync(syncDB, accounts.root, manager);
    await sync.init();
    sync.start();
    await sync.waitUntilFinished();
  });
});
