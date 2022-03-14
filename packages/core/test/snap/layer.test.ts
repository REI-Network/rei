import crypto from 'crypto';
import { assert, expect } from 'chai';
import { SecureTrie as Trie } from 'merkle-patricia-tree';
import { keccak256 } from 'ethereumjs-util';
import { FunctionalBufferMap, FunctionalBufferSet, getRandomIntInclusive } from '@rei-network/utils';
import { Common } from '@rei-network/common';
import { Database } from '@rei-network/database';
import { EMPTY_HASH } from '../../src/utils';
import { DiskLayer, DiffLayer, Snapshot, FastSnapIterator } from '../../src/snap';
import { AccountInfo, genRandomAccounts } from './util';
const level = require('level-mem');

const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);

/**
 * Randomly modify several accounts based on the last layer
 * @param db
 * @param root
 * @param lastLayerAccounts - Last layer account list
 * @param modifyCount
 * @returns Next layer account list and new state root
 */
async function modifyRandomAccounts(db: Database, root: Buffer, lastLayerAccounts: AccountInfo[], modifyCount: number) {
  lastLayerAccounts = [...lastLayerAccounts];
  const stateTrie = new Trie(db.rawdb, root);
  const accounts: AccountInfo[] = [];

  for (let i = 0; i < modifyCount; i++) {
    const index = getRandomIntInclusive(0, lastLayerAccounts.length - 1);
    const modifiedAccount = lastLayerAccounts[index].copy();
    const { address, account, storageData } = modifiedAccount;
    lastLayerAccounts.splice(index, 1);

    // randomly modify several keys
    const keys = Array.from(storageData.keys());
    const modifiedKeyCount = Math.ceil(keys.length / 2);
    const modifiedKeys: Buffer[] = [];
    for (let i = 0; i < modifiedKeyCount; i++) {
      const index = getRandomIntInclusive(0, keys.length - 1);
      const modifiedKey = keys[index];
      const { key, val } = storageData.get(modifiedKey)!;
      modifiedKeys.push(modifiedKey);
      keys.splice(index, 1);

      let newValue = crypto.randomBytes(32);
      while (newValue.equals(val)) {
        newValue = crypto.randomBytes(32);
      }

      storageData.set(modifiedKey, {
        key,
        val: newValue
      });
      const storageTrie = new Trie(db.rawdb, account.stateRoot);
      await storageTrie.put(key, newValue);
      account.stateRoot = storageTrie.root;
    }

    // delete all unmodified keys
    for (const key of keys) {
      storageData.delete(key);
    }

    await stateTrie.put(address, account.serialize());

    accounts.push(modifiedAccount);
  }

  return {
    root: stateTrie.root,
    accounts
  };
}

/**
 * Convert account list to diff layer
 * @param parent
 * @param root
 * @param accounts
 * @returns Diff layer
 */
function accountsToDiffLayer(parent: Snapshot, root: Buffer, accounts: AccountInfo[]) {
  const destructSet = new FunctionalBufferSet();
  const accountData = new FunctionalBufferMap<Buffer>();
  const storageData = new FunctionalBufferMap<FunctionalBufferMap<Buffer>>();

  for (const { address, account, storageData: _storageData } of accounts) {
    const accountHash = keccak256(address);
    accountData.set(accountHash, account.serialize());
    let storage = storageData.get(accountHash);
    if (!storage) {
      storage = new FunctionalBufferMap<Buffer>();
      storageData.set(accountHash, storage);
    }
    for (const [storageHash, storageValue] of _storageData) {
      storage.set(storageHash, storageValue.val);
    }
  }

  return DiffLayer.createDiffLayerFromParent(parent, root, destructSet, accountData, storageData);
}

type LayerInfo = {
  layer: Snapshot;
  accounts: AccountInfo[];
};

describe('Layer', () => {
  describe('DiskLayer', () => {
    const db = new Database(level(), common);
    let accounts!: AccountInfo[];
    let diskLayer!: DiskLayer;

    before(async () => {
      const { root, accounts: _accounts } = await genRandomAccounts(db, 10);
      accounts = _accounts;
      diskLayer = new DiskLayer(db, root);
    });

    it('should get account and storage data succeed', async () => {
      for (const { address, account, storageData } of accounts) {
        const accountHash = keccak256(address);
        const _account = await diskLayer.getAccount(accountHash);
        expect(_account.serialize().equals(account.serialize()), 'account should be equal').be.true;
        for (const [hash, { val }] of storageData) {
          const _v = await diskLayer.getStorage(accountHash, hash);
          expect(_v.equals(val), 'storage data should be equal').be.true;
        }
      }
    });

    it('should iterate account succeed', async () => {
      const _accounts = [...accounts];
      for await (const { hash, getValue } of diskLayer.genAccountIterator(EMPTY_HASH)) {
        const index = _accounts.findIndex(({ address }) => keccak256(address).equals(hash));
        expect(index !== -1, 'account should exist in accout list').be.true;
        expect(_accounts[index].account.serialize().equals(getValue().serialize()), 'accout should be equal').be.true;
        _accounts.splice(index, 1);
      }
      expect(_accounts.length, 'account list should be empty').be.equal(0);
    });

    it('should iterate storage data succeed', async () => {
      for (const { address, storageData: _storageData } of accounts) {
        // copy storage data
        const storageData = new FunctionalBufferMap<{ key: Buffer; val: Buffer }>();
        for (const [k, v] of _storageData) {
          storageData.set(k, { ...v });
        }

        const accountHash = keccak256(address);
        const { iter, destructed } = diskLayer.genStorageIterator(accountHash, EMPTY_HASH);
        expect(destructed, 'should not be destructed').be.false;
        for await (const { hash, getValue } of iter) {
          expect(storageData.get(hash)?.val.equals(getValue()), 'storage data should be equal').be.true;
          storageData.delete(hash);
        }
        expect(storageData.size, 'storage data should be empty').be.equal(0);
      }
    });
  });

  const db = new Database(level(), common);
  const layers: LayerInfo[] = [];
  describe('DiffLayer', () => {
    before(async () => {
      let count = 10;
      for (let i = 0; i < 3; i++) {
        if (i === 0) {
          // the first layer is diskLayer
          const { root, accounts } = await genRandomAccounts(db, count);
          layers.push({
            layer: new DiskLayer(db, root),
            accounts
          });
        } else {
          // the remaining layers are diffLayer
          const latest = layers[layers.length - 1];
          const { root, accounts } = await modifyRandomAccounts(db, latest.layer.root, latest.accounts, count);
          layers.push({
            layer: accountsToDiffLayer(latest.layer, root, accounts),
            accounts
          });
        }
        count = Math.ceil(count / 2);
      }
    });

    it('should get account succeed(when account exsits in this diff layer)', async () => {
      const { layer, accounts } = layers[2];
      const expectAccount = accounts[getRandomIntInclusive(0, accounts.length - 1)];
      const accountHash = keccak256(expectAccount.address);
      expect((layer as DiffLayer).diffed.check(accountHash), 'should hit diff layer bloom').be.true;
      const account = await layer.getAccount(accountHash);
      expect(account?.serialize()?.equals(expectAccount.account.serialize()), 'should be equal').be.true;
    });

    it('should get storage data succeed(when storage data exsits in this diff layer)', async () => {
      const { layer, accounts } = layers[2];
      const expectAccount = accounts[getRandomIntInclusive(0, accounts.length - 1)];
      const accountHash = keccak256(expectAccount.address);
      expect((layer as DiffLayer).diffed.check(accountHash), 'should hit diff layer bloom').be.true;
      const storageHashes = Array.from(expectAccount.storageData.keys());
      const storageHash = storageHashes[getRandomIntInclusive(0, storageHashes.length - 1)];
      const storageData = await layer.getStorage(accountHash, storageHash);
      expect(storageData?.equals(expectAccount.storageData.get(storageHash)!.val), 'should be equal').be.true;
    });

    it('should get account succeed(when account does not exsit in this diff layer but exsit in parent diff layer)', async () => {
      const { layer, accounts } = layers[2];
      const { accounts: _accounts } = layers[1];
      const index = _accounts.findIndex(({ address }) => accounts.findIndex(({ address: _address }) => address.equals(_address)) === -1);
      const expectAccount = _accounts[index];
      const accountHash = keccak256(expectAccount.address);
      expect((layer as DiffLayer).diffed.check(accountHash), 'should hit diff layer bloom').be.true;
      const account = await layer.getAccount(accountHash);
      expect(account?.serialize()?.equals(expectAccount.account.serialize()), 'should be equal').be.true;
    });

    it('should get storage data succeed(when storage data does not exsit in this diff layer but exsit in parent diff layer)', async () => {
      const { layer, accounts } = layers[2];
      const { accounts: _accounts } = layers[1];
      const index = _accounts.findIndex(({ address }) => accounts.findIndex(({ address: _address }) => address.equals(_address)) === -1);
      const expectAccount = _accounts[index];
      const accountHash = keccak256(expectAccount.address);
      expect((layer as DiffLayer).diffed.check(accountHash), 'should hit diff layer bloom').be.true;
      const storageHashes = Array.from(expectAccount.storageData.keys());
      const storageHash = storageHashes[getRandomIntInclusive(0, storageHashes.length - 1)];
      const storageData = await layer.getStorage(accountHash, storageHash);
      expect(storageData?.equals(expectAccount.storageData.get(storageHash)!.val), 'should be equal').be.true;
    });

    it('should get account succeed(when account does not exsit in this layer and only exist in disk layer)', async () => {
      const { layer, accounts } = layers[1];
      let { accounts: _accounts } = layers[0];
      _accounts = [..._accounts];
      let hit = true;
      while (hit && _accounts.length > 0) {
        const index = _accounts.findIndex(({ address }) => accounts.findIndex(({ address: _address }) => address.equals(_address)) === -1);
        if (index === -1) {
          break;
        }

        const expectAccount = _accounts[index];
        _accounts.splice(index, 1);
        const accountHash = keccak256(expectAccount.address);
        hit = (layer as DiffLayer).diffed.check(accountHash);
        const account = await layer.getAccount(accountHash);
        expect(account?.serialize()?.equals(expectAccount.account.serialize()), 'should be equal').be.true;
      }
      expect(hit, 'should not hit diff layer bloom').be.false;
    });

    it('should get storage data succeed(when storage data does not exsit in this layer and only exist in disk layer)', async () => {
      const { layer, accounts } = layers[1];
      let { accounts: _accounts } = layers[0];
      _accounts = [..._accounts];
      let hit = true;
      while (hit && _accounts.length > 0) {
        const index = _accounts.findIndex(({ address }) => accounts.findIndex(({ address: _address }) => address.equals(_address)) === -1);
        if (index === -1) {
          break;
        }

        const expectAccount = _accounts[index];
        _accounts.splice(index, 1);
        const accountHash = keccak256(expectAccount.address);
        hit = (layer as DiffLayer).diffed.check(accountHash);
        const storageHashes = Array.from(expectAccount.storageData.keys());
        const storageHash = storageHashes[getRandomIntInclusive(0, storageHashes.length - 1)];
        const storageData = await layer.getStorage(accountHash, storageHash);
        expect(storageData?.equals(expectAccount.storageData.get(storageHash)!.val), 'should be equal').be.true;
      }
      expect(hit, 'should not hit diff layer bloom').be.false;
    });

    it('should iterate account succeed', async () => {
      const diffLayers = layers.slice(1) as { layer: DiffLayer; accounts: AccountInfo[] }[];
      for (const { layer, accounts } of diffLayers) {
        const _accounts = [...accounts];
        for await (const { hash, getValue } of layer.genAccountIterator(EMPTY_HASH)) {
          const index = _accounts.findIndex(({ address }) => keccak256(address).equals(hash));
          expect(index !== -1, 'account should exist in accout list').be.true;
          const _account = getValue();
          expect(_account !== null, 'account should not be null').be.true;
          expect(_accounts[index].account.serialize().equals(_account!.serialize()), 'accout should be equal').be.true;
          _accounts.splice(index, 1);
        }
        expect(_accounts.length, 'account list should be empty').be.equal(0);
      }
    });

    it('should iterate storage data succeed', async () => {
      const diffLayers = layers.slice(1) as { layer: DiffLayer; accounts: AccountInfo[] }[];
      for (const { layer, accounts } of diffLayers) {
        for (const { address, storageData: _storageData } of accounts) {
          // copy storage data
          const storageData = new FunctionalBufferMap<{ key: Buffer; val: Buffer }>();
          for (const [k, v] of _storageData) {
            storageData.set(k, { ...v });
          }

          const accountHash = keccak256(address);
          const { iter, destructed } = layer.genStorageIterator(accountHash, EMPTY_HASH);
          expect(destructed, 'should not be destructed').be.false;
          for await (const { hash, getValue } of iter) {
            expect(storageData.get(hash)?.val.equals(getValue()), 'storage data should be equal').be.true;
            storageData.delete(hash);
          }
          expect(storageData.size, 'storage data should be empty').be.equal(0);
        }
      }
    });
  });

  describe('FastIterator', () => {
    it('should fast iterate account succeed', async () => {
      const { layer } = layers[2];
      const fastIter = new FastSnapIterator(layer, (snap) => {
        return {
          iter: snap.genAccountIterator(EMPTY_HASH),
          stop: false
        };
      });
      await fastIter.init();

      let totalCount = 0;
      for await (const { hash, value } of fastIter) {
        const expectAccount = await layer.getAccount(hash);
        expect(expectAccount?.serialize().equals(value.serialize()), 'account should be equal').be.true;
        totalCount++;
      }
      expect(totalCount, 'total count should be equal').be.equal(layers[0].accounts.length);
    });

    it('should fast iterate storage data succeed', async () => {
      const { layer } = layers[2];

      for (const { address } of layers[0].accounts) {
        const accountHash = keccak256(address);
        const fastIter = new FastSnapIterator(layer, (snap) => {
          const { iter, destructed } = snap.genStorageIterator(accountHash, EMPTY_HASH);
          return {
            iter,
            stop: destructed
          };
        });
        await fastIter.init();

        let totalCount = 0;
        for await (const { hash, value } of fastIter) {
          const expectStorageData = await layer.getStorage(accountHash, hash);
          expect(expectStorageData.equals(value), 'storage data should be equal').be.true;
          totalCount++;
        }
        expect(totalCount, 'total count should be equal').be.equal(layers[0].accounts[0].storageData.size);
      }
    });

    it('should abort succeed', async () => {
      const { layer } = layers[2];
      const fastIter = new FastSnapIterator(layer, (snap) => {
        return {
          iter: snap.genAccountIterator(EMPTY_HASH),
          stop: false
        };
      });
      await fastIter.init();

      let index = 0;
      for await (const element of fastIter) {
        if (++index === 3) {
          await fastIter.abort();
        }
      }
      expect(index === 3, 'iterator should abort').be.true;
    });

    it('should prohibite repeated iterations', async () => {
      const { layer } = layers[2];
      const fastIter = new FastSnapIterator(layer, (snap) => {
        return {
          iter: snap.genAccountIterator(EMPTY_HASH),
          stop: false
        };
      });
      await fastIter.init();

      const doIter = async () => {
        for await (const element of fastIter) {
        }
      };

      try {
        await Promise.all([doIter(), doIter()]);
        assert.fail('should prohibite repeated iterations');
      } catch (err) {
      } finally {
        await fastIter.abort();
      }
    });
  });
});
