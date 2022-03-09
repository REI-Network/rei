import crypto from 'crypto';
import { expect } from 'chai';
import { SecureTrie as Trie } from 'merkle-patricia-tree';
import { Account, BN, keccak256 } from 'ethereumjs-util';
import { FunctionalBufferMap, FunctionalBufferSet, getRandomIntInclusive } from '@rei-network/utils';
import { Common } from '@rei-network/common';
import { Database, DBSaveSnapStorage, DBSaveSerializedSnapAccount } from '@rei-network/database';
import { DiskLayer, DiffLayer, Snapshot } from '../../src/snap';
const level = require('level-mem');

const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);

class AccountInfo {
  address: Buffer;
  account: Account;
  storageData: FunctionalBufferMap<Buffer>;

  constructor(address: Buffer, account: Account, storageData: FunctionalBufferMap<Buffer>) {
    this.address = address;
    this.account = account;
    this.storageData = storageData;
  }

  copy() {
    const storageData = new FunctionalBufferMap<Buffer>();
    for (const [k, v] of this.storageData) {
      storageData.set(k, v);
    }
    return new AccountInfo(Buffer.from(this.address), new Account(this.account.nonce.clone(), this.account.balance.clone(), Buffer.from(this.account.stateRoot)), storageData);
  }
}

/**
 * Randomly generate several accounts and 10 random storage data for each account
 * @param db
 * @param genCount
 * @returns Account list and state root
 */
async function genRandomAccounts(db: Database, genCount: number) {
  const stateTrie = new Trie(db.rawdb);
  const accounts: AccountInfo[] = [];

  for (let i = 0; i < genCount; i++) {
    const address = crypto.randomBytes(20);
    const accountHash = keccak256(address);
    const storageTrie = new Trie(db.rawdb);
    const storageData = new FunctionalBufferMap<Buffer>();
    for (let i = 0; i < 10; i++) {
      const key = crypto.randomBytes(32);
      const value = crypto.randomBytes(32);
      await db.batch([DBSaveSnapStorage(accountHash, key, value)]);
      await storageTrie.put(key, value);
      storageData.set(key, value);
    }
    const account = new Account(new BN(1), new BN(1), storageTrie.root);
    await db.batch([DBSaveSerializedSnapAccount(accountHash, account.serialize())]);
    await stateTrie.put(address, account.serialize());
    accounts.push(new AccountInfo(address, account, storageData));
  }

  return {
    root: stateTrie.root,
    accounts
  };
}

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
      modifiedKeys.push(modifiedKey);
      keys.splice(index, 1);

      let newValue = crypto.randomBytes(32);
      while (newValue.equals(storageData.get(modifiedKey)!)) {
        newValue = crypto.randomBytes(32);
      }

      storageData.set(modifiedKey, newValue);
      const storageTrie = new Trie(db.rawdb, account.stateRoot);
      await storageTrie.put(modifiedKey, newValue);
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
      storage.set(storageHash, storageValue);
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

    it('should get account and storage data succeed', async () => {
      const { root, accounts } = await genRandomAccounts(db, 10);
      const diskLayer = new DiskLayer(db, new Trie(db.rawdb, root), root);
      for (const { address, account, storageData } of accounts) {
        const accountHash = keccak256(address);
        const _account = await diskLayer.getAccount(accountHash);
        expect(_account.serialize().equals(account.serialize()), 'account should be equal').be.true;
        for (const [k, v] of storageData) {
          const _v = await diskLayer.getStorage(accountHash, k);
          expect(_v.equals(v), 'storage data should be equal').be.true;
        }
      }
    });
  });

  describe('DiffLayer', () => {
    const db = new Database(level(), common);
    const layers: LayerInfo[] = [];

    before(async () => {
      let count = 10;
      for (let i = 0; i < 3; i++) {
        if (i === 0) {
          // the first layer is diskLayer
          const { root, accounts } = await genRandomAccounts(db, count);
          layers.push({
            layer: new DiskLayer(db, new Trie(db.rawdb, root), root),
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
      expect(storageData?.equals(expectAccount.storageData.get(storageHash)!), 'should be equal').be.true;
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
      expect(storageData?.equals(expectAccount.storageData.get(storageHash)!), 'should be equal').be.true;
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
        expect(storageData?.equals(expectAccount.storageData.get(storageHash)!), 'should be equal').be.true;
      }
      expect(hit, 'should not hit diff layer bloom').be.false;
    });
  });
});
