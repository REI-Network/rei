import { assert, expect } from 'chai';
import { keccak256 } from 'ethereumjs-util';
import { FunctionalBufferMap, getRandomIntInclusive } from '@rei-network/utils';
import { Common } from '@rei-network/common';
import { Database } from '@rei-network/database';
import { EMPTY_HASH } from '../../src/utils';
import { DiskLayer, DiffLayer, Snapshot, FastSnapIterator } from '../../src/snap';
import { AccountInfo, genRandomAccounts, modifyRandomAccounts, accountsToDiffLayer } from './util';
const level = require('level-mem');

const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);

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
      const { root, accounts: _accounts } = await genRandomAccounts(db, 10, 10);
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
          const { root, accounts } = await genRandomAccounts(db, count, 10);
          layers.push({
            layer: new DiskLayer(db, root),
            accounts
          });
        } else {
          // the remaining layers are diffLayer
          const latest = layers[layers.length - 1];
          const { root, accounts } = await modifyRandomAccounts(db, latest.layer.root, latest.accounts, count);
          layers.push({
            layer: accountsToDiffLayer(latest.layer as Snapshot, root, accounts),
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
      let totalCount = 0;
      for await (const { hash, value } of new FastSnapIterator(layer, (snap) => {
        return {
          iter: snap.genAccountIterator(EMPTY_HASH),
          stop: false
        };
      })) {
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
        let totalCount = 0;
        for await (const { hash, value } of new FastSnapIterator(layer, (snap) => {
          const { iter, destructed } = snap.genStorageIterator(accountHash, EMPTY_HASH);
          return {
            iter,
            stop: destructed
          };
        })) {
          const expectStorageData = await layer.getStorage(accountHash, hash);
          expect(expectStorageData.equals(value), 'storage data should be equal').be.true;
          totalCount++;
        }
        expect(totalCount, 'total count should be equal').be.equal(layers[0].accounts[0].storageData.size);
      }
    });

    it('should abort succeed', async () => {
      const { layer } = layers[2];
      let index = 0;
      for await (const element of new FastSnapIterator(layer, (snap) => {
        return {
          iter: snap.genAccountIterator(EMPTY_HASH),
          stop: false
        };
      })) {
        if (++index === 3) {
          break;
        }
      }
      expect(index === 3, 'iterator should abort').be.true;
    });

    it('should skip empty buffer', async () => {
      const { layer } = layers[2];
      const data = (layer as DiffLayer).storageData;
      const [accountHash, storage] = Array.from(data.entries())[0];
      const [hash] = Array.from(storage.entries())[0];
      storage.set(hash, Buffer.alloc(0));
      for await (const { hash: _hash, value: _value } of new FastSnapIterator(layer, (snap) => {
        const { iter, destructed } = snap.genStorageIterator(accountHash, EMPTY_HASH);
        return {
          iter: iter,
          stop: destructed
        };
      })) {
        if (hash.equals(_hash)) {
          assert.fail('should skip empty buffer');
        }
      }
    });
  });
});
