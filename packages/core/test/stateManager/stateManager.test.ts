import crypto from 'crypto';
import { expect } from 'chai';
import { encode } from 'rlp';
import { Address, BN, keccak256, unpadBuffer, Account } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { FunctionalBufferMap, FunctionalBufferSet } from '@rei-network/utils';
import { Database } from '@rei-network/database';
import { Trie } from 'merkle-patricia-tree/dist/baseTrie';
import { StateManager, StakingAccount } from '../../src/stateManager';
import { SnapTree } from '../../src/snap/snapTree';
import { genRandomAccounts } from '../snap/util';

class MockNode {
  public latestBlock: { header: { number: BN } } = { header: { number: new BN(1) } };
  public db: { getSnapRecoveryNumber: any } = { getSnapRecoveryNumber: async () => new BN(0) };
}

function compareBufferMaps(map1: FunctionalBufferMap<Buffer>, map2: FunctionalBufferMap<Buffer>) {
  if (map1.size !== map2.size) {
    return false;
  }
  for (const [key, val] of map1) {
    const testVal = map2.get(key);
    if (!testVal?.equals(val)) {
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
class MockSnapTree extends SnapTree {
  public callback: (accounts: FunctionalBufferMap<Buffer>, destructs: FunctionalBufferSet, storage: FunctionalBufferMap<FunctionalBufferMap<Buffer>>) => void = () => {};
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
  let snapTree: MockSnapTree | undefined;
  let mockSnapTree: MockSnapTree;
  before(async () => {
    const common = new Common({ chain: 'rei-testnet' });
    common.setHardforkByBlockNumber(0);
    const cache = 100;
    const level = require('level-mem');
    const db = new Database(level(), common);
    const async = true;
    const rebuild = true;
    const recovery = true;
    const rootAndAccounts = await genRandomAccounts(db, 0, 0);
    const root = rootAndAccounts.root;
    const node = new MockNode();
    let snapTreeTemp = new SnapTree(db, cache, root, node as any);
    await snapTreeTemp.init(root, async, rebuild);
    snapTree = snapTreeTemp as MockSnapTree;
    stateManager = new StateManager({
      common: common,
      snapsTree: snapTree
    });
  });

  it('should checkpoint correctly', async () => {
    expect(stateManager._snapCacheList.length === 0, 'CacheList should be empty').be.true;
    await stateManager.checkpoint();
    expect(stateManager._snapCacheList.length === 1, 'CacheList length should be equal').be.true;
    const lastCache = stateManager._snapCacheList[stateManager._snapCacheList.length - 1];
    expect(lastCache.snapAccounts?.size === 0, 'snapAccounts should be empty').be.true;
    expect(lastCache.snapDestructs?.size === 0, 'snapDestructs should be empty').be.true;
    expect(lastCache.snapStroge?.size === 0, 'snapStorage should be empty').be.true;
    const callback = (accounts: FunctionalBufferMap<Buffer>, destructs: FunctionalBufferSet, storage: FunctionalBufferMap<FunctionalBufferMap<Buffer>>) => {
      expect(accounts.size === 0, '_snapAccounts should be empty').be.true;
      expect(destructs.size === 0, '_snapDestructs should be empty').be.true;
      expect(storage.size === 0, '_snapStorage should be empty').be.true;
    };
    snapTree!.callback = callback;
    await stateManager.commit();
    expect(stateManager._snapCacheList.length === 0, 'CacheList should be empty').be.true;
  });

  it('should putAccount correctly', async () => {
    await stateManager.setStateRoot(stateManager._trie.root);
    await stateManager.checkpoint();
    const accountMap = new FunctionalBufferMap<Buffer>();
    await stateManager.putAccount(address, account1);
    accountMap.set(kecAddress, account1.slimSerialize());
    const callback = (accounts: FunctionalBufferMap<Buffer>, destructs: FunctionalBufferSet, storage: FunctionalBufferMap<FunctionalBufferMap<Buffer>>) => {
      expect(compareBufferMaps(accountMap, accounts), '_snapAccounts should be equal').be.true;
      expect(destructs.size === 0, '_snapDestructs should be empty').be.true;
      expect(storage.size === 0, '_snapStorage should be empty').be.true;
    };
    snapTree!.callback = callback;
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
    const callback = (accounts: FunctionalBufferMap<Buffer>, destructs: FunctionalBufferSet, storage: FunctionalBufferMap<FunctionalBufferMap<Buffer>>) => {
      expect(destructs.size === 0, '_snapDestructs should be empty').be.true;
      expect(compareBufferMaps(accounts, accountMap), '_snapAccounts should be equal');
      let storageEqual = true;
      expect(storage.size === storageMap.size, '_snapStorage size should euqual to storageMap');
      for (const [key, value] of storage) {
        const temp = storageMap.get(key);
        if (!compareBufferMaps(temp!, value)) {
          storageEqual = false;
          break;
        }
      }
      expect(storageEqual === true, '_snapStorage should be equal').be.true;
    };
    snapTree!.callback = callback;
    await stateManager.commit();
  });

  it('should deleteAccount correctly', async () => {
    await stateManager.setStateRoot(stateManager._trie.root);
    await stateManager.checkpoint();
    await stateManager.putContractStorage(address, key1, value1);
    await stateManager.deleteAccount(address);
    const destructsSet = new FunctionalBufferSet();
    destructsSet.add(kecAddress);
    const callback = (accounts: FunctionalBufferMap<Buffer>, destructs: FunctionalBufferSet, storage: FunctionalBufferMap<FunctionalBufferMap<Buffer>>) => {
      expect(accounts.has(kecAddress), 'account1 should be deleted in _snapAccounts').be.false;
      expect(storage.has(kecAddress), 'account1 should be deleted in _snapStorage').be.false;
      expect(compareSets(destructsSet, destructs), 'destructs should equal to destructsSet').be.true;
    };
    snapTree!.callback = callback;
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
    const callback = (accounts: FunctionalBufferMap<Buffer>, destructs: FunctionalBufferSet, storage: FunctionalBufferMap<FunctionalBufferMap<Buffer>>) => {
      expect(compareBufferMaps(accountMap, accounts), '_snapAccounts should be equal').be.true;
      expect(compareSets(destructsSet, destructs), 'destructs should equal to destructsSet').be.true;
      expect(storage.size === 0, '_snapStorage should be empty').be.true;
    };
    snapTree!.callback = callback;
    await stateManager.commit();
  });

  it('should clearContractStorage correctly', async () => {
    await stateManager.setStateRoot(stateManager._trie.root);
    await stateManager.checkpoint();
    const storageTemp = new FunctionalBufferMap<Buffer>();
    storageTemp.set(kecKey1, encodeValue1);
    const storageMap = new FunctionalBufferMap<FunctionalBufferMap<Buffer>>();
    storageMap.set(kecAddress, storageTemp);
    expect(stateManager._snapStorage?.size === storageMap.size, '_snapStorage size should euqual to storageMap');
    let storageEqual = true;
    for (const [key, value] of stateManager._snapStorage!) {
      const temp = storageMap.get(key);
      if (!compareBufferMaps(temp!, value)) {
        storageEqual = false;
        break;
      }
    }
    expect(storageEqual === true, '_snapStorage should be equal').be.true;
    const callback = (accounts: FunctionalBufferMap<Buffer>, destructs: FunctionalBufferSet, storage: FunctionalBufferMap<FunctionalBufferMap<Buffer>>) => {
      expect(accounts.size === 0, 'snapAccounts should be empty').be.true;
      expect(destructs.size === 0, 'snapDestructs should be empty').be.true;
      expect(storage.size === 0, '_snapStorage should be empty').be.true;
    };
    snapTree!.callback = callback;
    await stateManager.commit();
  });

  it('should revert correctly', async () => {
    await stateManager.setStateRoot(stateManager._trie.root);
    await stateManager.checkpoint();
    await stateManager.putAccount(address, account1);
    await stateManager.revert();
    expect(stateManager._snap === undefined, '_snap should be undifined').be.true;
    expect(stateManager._snapAccounts === undefined, '_snap should be undifined').be.true;
    expect(stateManager._snapDestructs === undefined, '_snap should be undifined').be.true;
    expect(stateManager._snapStorage === undefined, '_snap should be undifined').be.true;
  });
});
