import { assert, expect } from 'chai';
import { keccak256 } from 'ethereumjs-util';
import { Database, DBDeleteSnapAccount, DBDeleteSnapStorage } from '@rei-network/database';
import { Common } from '@rei-network/common';
import { EMPTY_HASH } from '../../src/utils';
import { DiskLayer } from '../../src/snap';
import { SnapJournalGenerator } from '../../src/snap/journal';
import { DBatch } from '../../src/snap/batch';
import { AccountInfo, genRandomAccounts } from './util';
import { BN } from 'bn.js';
const level = require('level-mem');

const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);

describe('GenerateSnapshot', () => {
  const db = new Database(level(), common);
  let accounts!: AccountInfo[];
  let diskLayer!: DiskLayer;

  async function shouldNotExist(getFunc: () => Promise<any>) {
    try {
      await getFunc();
      assert.fail('should not exist');
    } catch (err: any) {
      if (err.type === 'NotFoundError') {
        // ignore
      } else {
        throw err;
      }
    }
  }

  before(async () => {
    const { root, accounts: _accounts } = await genRandomAccounts(db, 200, 10, false);
    accounts = _accounts;
    diskLayer = new DiskLayer(db, root);
  });

  it('should generate succeed', async () => {
    await diskLayer.generate({
      origin: EMPTY_HASH,
      start: Date.now(),
      accounts: new BN(0),
      slots: new BN(0),
      storage: new BN(0)
    });
    expect(diskLayer.genMarker === undefined, 'should generate finished').be.true;

    const batch = new DBatch(db);
    for (const { address, account, storageData } of accounts) {
      const accountHash = keccak256(address);
      const _account = await db.getSerializedSnapAccount(accountHash);
      expect(_account.equals(account.serialize()), 'account should be equal').be.true;
      batch.push(DBDeleteSnapAccount(accountHash));
      for (const [storageHash, { key, val }] of storageData) {
        const _stoargeValue = await db.getSnapStorage(accountHash, storageHash);
        expect(_stoargeValue.equals(val), 'storage data should be equal').be.true;
        batch.push(DBDeleteSnapStorage(accountHash, storageHash));
      }
    }

    const serializedGenerator = await db.getSnapGenerator();
    expect(serializedGenerator !== null).be.true;
    const { done, marker, accounts: _accounts, slots, storage } = SnapJournalGenerator.fromSerializedJournal(serializedGenerator!);
    expect(done).be.true;
    expect(marker.equals(EMPTY_HASH)).be.true;
    expect(_accounts.toNumber()).be.equal(200);
    expect(slots.toNumber()).be.equal(200 * 10);
    /**
     * one account = SNAP_ACCOUNT_PREFIX(1) + accountHash(32) + account.serialize().length(70)
     * one slot = SNAP_STORAGE_PREFIX(1) + accountHash(32) + storageHash(32) + storageValue(32)
     */
    expect(storage.toNumber()).be.equal(200 * (1 + 32 + 70) + 200 * 10 * (1 + 32 + 32 + 32));

    await batch.write();
    batch.reset();
  });

  it('should abort succeed', async () => {
    diskLayer.generate({
      origin: EMPTY_HASH,
      start: Date.now(),
      accounts: new BN(0),
      slots: new BN(0),
      storage: new BN(0)
    });
    await new Promise((r) => setTimeout(r, 100));
    await diskLayer.abort();
    expect(diskLayer.genMarker !== undefined, 'should not generate finished').be.true;
    const accMarker = diskLayer.genMarker!.slice(0, 32);

    for (const { address, account, storageData } of accounts) {
      const accountHash = keccak256(address);
      const cmp = accountHash.compare(accMarker);
      if (cmp < 0) {
        const _account = await db.getSerializedSnapAccount(accountHash);
        expect(_account.equals(account.serialize()), 'account should be equal').be.true;
        for (const [storageHash, { val }] of storageData) {
          const _stoargeValue = await db.getSnapStorage(accountHash, storageHash);
          expect(_stoargeValue.equals(val), 'storage data should be equal').be.true;
        }
      } else if (cmp > 0) {
        await shouldNotExist(() => db.getSerializedSnapAccount(accountHash));
        for (const [storageHash] of storageData) {
          await shouldNotExist(() => db.getSnapStorage(accountHash, storageHash));
        }
      } else if (cmp === 0 && diskLayer.genMarker!.length === 32) {
        const _account = await db.getSerializedSnapAccount(accountHash);
        expect(_account.equals(account.serialize()), 'account should be equal').be.true;
        for (const [storageHash] of storageData) {
          await shouldNotExist(() => db.getSnapStorage(accountHash, storageHash));
        }
      } else if (cmp === 0 && diskLayer.genMarker!.length === 32 + 32) {
        const _account = await db.getSerializedSnapAccount(accountHash);
        expect(_account.equals(account.serialize()), 'account should be equal').be.true;
        for (const [storageHash, { val }] of storageData) {
          const cmp = storageHash.compare(diskLayer.genMarker!.slice(32));
          if (cmp <= 0) {
            const _stoargeValue = await db.getSnapStorage(accountHash, storageHash);
            expect(_stoargeValue.equals(val), 'storage data should be equal').be.true;
          } else {
            await shouldNotExist(() => db.getSnapStorage(accountHash, storageHash));
          }
        }
      } else {
        throw new Error('unknown error');
      }
    }

    const serializedGenerator = await db.getSnapGenerator();
    expect(serializedGenerator !== null).be.true;
    const { done, marker, accounts: _accounts, slots, storage } = SnapJournalGenerator.fromSerializedJournal(serializedGenerator!);
    expect(done).be.false;
    expect(marker.equals(diskLayer.genMarker!)).be.true;
    expect(_accounts.toNumber() < 200).be.true;
    expect(slots.toNumber() < 200 * 10).be.true;
    /**
     * one account = SNAP_ACCOUNT_PREFIX(1) + accountHash(32) + account.serialize().length(70)
     * one slot = SNAP_STORAGE_PREFIX(1) + accountHash(32) + storageHash(32) + storageValue(32)
     */
    const total = _accounts.toNumber() * (1 + 32 + 70) + slots.toNumber() * (1 + 32 + 32 + 32);
    expect(storage.toNumber()).be.equal(total);
  });
});
