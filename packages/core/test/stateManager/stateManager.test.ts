import crypto from 'crypto';
import { expect } from 'chai';
import { encode } from 'rlp';
import { Address, BN, keccak256, unpadBuffer } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { FunctionalBufferMap, FunctionalBufferSet } from '@rei-network/utils';
import { Database } from '@rei-network/database';
import { Trie } from 'merkle-patricia-tree/dist/baseTrie';
import { StateManager, StakingAccount } from '../../src/stateManager';
import { SnapTree } from '../../src/snap/snapTree';
import { genRandomAccounts } from '../snap/util';

function compareBufferMaps(map1: FunctionalBufferMap<Buffer>, map2: FunctionalBufferMap<Buffer>) {
  if (map1.size !== map2.size) {
    return false;
  }
  for (const [key, val] of map1) {
    const testVal = map2.get(key);
    if (!testVal!.equals(val)) {
      return false;
    }
  }
  return true;
}

function compareSets<k>(set1: Set<k>, set2: Set<k>) {
  if (set1.size !== set2.size) {
    return false;
  }
  for (const key of set1) {
    if (!set2.has(key)) {
      return false;
    }
  }
  return true;
}

describe('StateManager', () => {
  const address = Address.fromString('0xAE0c03FdeDB61021272922F7804505CEE2C12c78');
  const key1 = crypto.randomBytes(32);
  const kecKey1 = keccak256(key1);
  const value1 = crypto.randomBytes(32);
  const encodeValue1 = encode(unpadBuffer(value1));
  const kecAddress = keccak256(address.buf);
  const account1 = StakingAccount.fromAccountData({ balance: new BN(12) });
  const account2 = StakingAccount.fromAccountData({ balance: new BN(34) });
  let stateManager: StateManager;
  before(async () => {
    const common = new Common({ chain: 'rei-devnet' });
    common.setHardforkByBlockNumber(0);
    const level = require('level-mem');
    const db = new Database(level(), common);
    const rootAndAccounts = await genRandomAccounts(db, 0, 0);
    const root = rootAndAccounts.root;
    const snapTree = new SnapTree(db);
    await snapTree.init(root, true, true);
    stateManager = new StateManager({
      common: common,
      snapsTree: snapTree
    });
  });

  it('should checkpoint correctly', async () => {
    expect(stateManager._snapCacheList.length, 'CacheList should be empty').be.equal(0);
    await stateManager.checkpoint();
    expect(stateManager._snapCacheList.length, 'CacheList length should be equal').be.equal(1);
    const lastCache = stateManager._snapCacheList[stateManager._snapCacheList.length - 1];
    expect(lastCache.snapAccounts!.size, 'snapAccounts should be empty').be.equal(0);
    expect(lastCache.snapDestructs!.size, 'snapDestructs should be empty').be.equal(0);
    expect(lastCache.snapStroge!.size, 'snapStorage should be empty').be.equal(0);
    expect(stateManager._snapAccounts!.size, '_snapAccounts should be empty').be.equal(0);
    expect(stateManager._snapDestructs!.size, '_snapDestructs should be empty').be.equal(0);
    expect(stateManager._snapStorage!.size, '_snapStorage should be empty').be.equal(0);
    await stateManager.commit();
    expect(stateManager._snapCacheList.length, 'CacheList should be empty').be.equal(0);
  });

  it('should putAccount correctly', async () => {
    await stateManager.setStateRoot(stateManager._trie.root);
    await stateManager.checkpoint();
    const accountMap = new FunctionalBufferMap<Buffer>();
    await stateManager.putAccount(address, account1);
    accountMap.set(kecAddress, account1.slimSerialize());
    expect(compareBufferMaps(accountMap, stateManager._snapAccounts!), '_snapAccounts should be equal').be.true;
    expect(stateManager._snapDestructs!.size, '_snapDestructs should be empty').be.equal(0);
    expect(stateManager._snapStorage!.size, '_snapStorage should be empty').be.equal(0);
    await stateManager.commit();
  });

  it('should putContractStorage correctly', async () => {
    await stateManager.setStateRoot(stateManager._trie.root);
    await stateManager.checkpoint();
    await stateManager.putContractStorage(address, key1, value1);
    const accountNow = await stateManager.getAccount(address);
    const accountMap = new FunctionalBufferMap<Buffer>();
    accountMap.set(kecAddress, accountNow.slimSerialize());
    const storageTemp = new FunctionalBufferMap<Buffer>();
    storageTemp.set(kecKey1, encodeValue1);
    const storageMap = new FunctionalBufferMap<FunctionalBufferMap<Buffer>>();
    storageMap.set(kecAddress, storageTemp);
    const trie = new Trie();
    await trie.put(kecKey1, encodeValue1);
    expect(accountNow.stateRoot.equals(trie.root), 'account stateroot should be equal');
    expect(stateManager._snapDestructs!.size, '_snapDestructs should be empty').be.equal(0);
    expect(compareBufferMaps(stateManager._snapAccounts!, accountMap), '_snapAccounts should be equal');
    let storageEqual = true;
    expect(stateManager._snapStorage!.size, '_snapStorage size should euqual to storageMap').be.equal(storageMap.size);
    for (const [key, value] of stateManager._snapStorage!) {
      const temp = storageMap.get(key);
      if (!compareBufferMaps(temp!, value)) {
        storageEqual = false;
        break;
      }
    }
    expect(storageEqual, '_snapStorage should be equal').be.equal(true);
    await stateManager.commit();
  });

  it('should deleteAccount correctly', async () => {
    await stateManager.setStateRoot(stateManager._trie.root);
    await stateManager.checkpoint();
    await stateManager.putContractStorage(address, key1, value1);
    await stateManager.deleteAccount(address);
    const destructsSet = new FunctionalBufferSet();
    destructsSet.add(kecAddress);

    expect(stateManager._snapAccounts!.has(kecAddress), 'account1 should be deleted in _snapAccounts').be.false;
    expect(stateManager._snapStorage!.has(kecAddress), 'account1 should be deleted in _snapStorage').be.false;
    expect(compareSets(destructsSet, stateManager._snapDestructs!), 'destructs should equal to destructsSet').be.true;

    await stateManager.commit();
  });

  it('should rebuild account correctly', async () => {
    await stateManager.setStateRoot(stateManager._trie.root);
    await stateManager.checkpoint();
    await stateManager.putAccount(address, account1);
    await stateManager.deleteAccount(address);
    await stateManager.putAccount(address, account2);
    const accountMap = new FunctionalBufferMap<Buffer>();
    accountMap.set(kecAddress, account2.slimSerialize());
    const destructsSet = new FunctionalBufferSet();
    destructsSet.add(kecAddress);
    expect(compareBufferMaps(accountMap, stateManager._snapAccounts!), '_snapAccounts should be equal').be.true;
    expect(compareSets(destructsSet, stateManager._snapDestructs!), 'destructs should equal to destructsSet').be.true;
    expect(stateManager._snapStorage!.size, '_snapStorage should be empty').be.equal(0);
    await stateManager.commit();
  });

  it('should clearContractStorage correctly', async () => {
    await stateManager.setStateRoot(stateManager._trie.root);
    await stateManager.checkpoint();
    const storageTemp = new FunctionalBufferMap<Buffer>();
    storageTemp.set(kecKey1, encodeValue1);
    const storageMap = new FunctionalBufferMap<FunctionalBufferMap<Buffer>>();
    storageMap.set(kecAddress, storageTemp);
    await stateManager.putContractStorage(address, key1, value1);
    expect(stateManager._snapStorage!.size, '_snapStorage size should euqual to storageMap').be.equal(storageMap.size);
    let storageEqual = true;
    for (const [key, value] of stateManager._snapStorage!) {
      const temp = storageMap.get(key);
      if (!compareBufferMaps(temp!, value)) {
        storageEqual = false;
        break;
      }
    }
    await stateManager.clearContractStorage(address);
    expect(storageEqual, '_snapStorage should be equal').be.equal(true);
    expect(stateManager._snapDestructs!.size, 'snapDestructs should be empty').be.equal(0);
    expect(stateManager._snapStorage!.size, '_snapStorage should be empty').be.equal(0);
    await stateManager.commit();
  });

  it('should revert correctly', async () => {
    await stateManager.setStateRoot(stateManager._trie.root);
    await stateManager.checkpoint();
    await stateManager.putAccount(address, account1);
    const lastCache = stateManager._snapCacheList[stateManager._snapCacheList.length - 1];
    await stateManager.revert();
    expect(compareBufferMaps(stateManager._snapAccounts!, lastCache.snapAccounts!), 'revert _snapAccounts should be equal').be.true;
    expect(compareSets(stateManager._snapDestructs!, lastCache.snapDestructs!), 'revert _snapDestructs should be equal').be.true;
    let storageEqual = true;
    for (const [key, value] of stateManager._snapStorage!) {
      const temp = lastCache.snapStroge!.get(key);
      if (!compareBufferMaps(temp!, value)) {
        storageEqual = false;
        break;
      }
    }
    expect(storageEqual, 'revert _snapStorage should be equal').be.equal(true);
  });
});
