import crypto from 'crypto';
import { expect } from 'chai';
import { Common } from '@rei-network/common';
import { StateManager, StakingAccount } from '../../src/stateManager';
import { Snapshot, SnapshotTree } from '../../src/stateManager/types';
import { FunctionalBufferMap, FunctionalBufferSet } from '@rei-network/utils';
import { Address, BN, keccak256, unpadBuffer, Account } from 'ethereumjs-util';
import { encode } from 'rlp';
import { Trie } from 'merkle-patricia-tree/dist/baseTrie';

class MockSnap implements Snapshot {
  _root: Buffer;
  constructor(root: Buffer) {
    this._root = root;
  }

  parent(): Snapshot {
    throw new Error('this function not realized');
  }

  root() {
    return this._root;
  }

  account(hash: Buffer): Account {
    throw new Error('this function not realized');
  }

  accountRLP(hash: Buffer): Buffer {
    throw new Error('this function not realized');
  }

  update(blockRoot: Buffer, destructs: Map<Buffer, Buffer>, accounts: Map<Buffer, Buffer>, storage: Map<Buffer, Buffer>): Promise<Snapshot> {
    throw new Error('this function not realized');
  }
}

class MockSnapTree implements SnapshotTree {
  snapshot(blockRoot: Buffer): Snapshot {
    return new MockSnap(blockRoot);
  }

  public callback: (accounts: FunctionalBufferMap<Buffer>, destructs: FunctionalBufferSet, storage: FunctionalBufferMap<FunctionalBufferMap<Buffer>>) => void = () => {};

  async cap(root: Buffer, layers: number): Promise<void> {}

  async update(root: Buffer, parent: Buffer, accounts: FunctionalBufferMap<Buffer>, destructs: FunctionalBufferSet, storage: FunctionalBufferMap<FunctionalBufferMap<Buffer>>): Promise<void> {
    this.callback(accounts, destructs, storage);
  }
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

describe('StateManager', () => {
  const common = new Common({ chain: 'rei-testnet' });
  common.setHardforkByBlockNumber(0);

  const snapTree = new MockSnapTree();
  const address = Address.fromString('0xAE0c03FdeDB61021272922F7804505CEE2C12c78');
  const kecAddress = keccak256(address.buf);
  const account1 = StakingAccount.fromAccountData({ balance: new BN(12) });
  const account2 = StakingAccount.fromAccountData({ balance: new BN(34) });
  const key1 = crypto.randomBytes(32);
  const kec1Key = keccak256(key1);
  const value1 = crypto.randomBytes(32);
  const encodeValue1 = encode(unpadBuffer(value1));
  const stateManager = new StateManager({
    common,
    snapsTree: snapTree
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
    snapTree.callback = callback;
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
    snapTree.callback = callback;
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
    storageTemp.set(kec1Key, encodeValue1);
    const storageMap = new FunctionalBufferMap<FunctionalBufferMap<Buffer>>();
    storageMap.set(kecAddress, storageTemp);
    const trie = new Trie();
    await trie.put(kec1Key, encodeValue1);
    const callback = (accounts: FunctionalBufferMap<Buffer>, destructs: FunctionalBufferSet, storage: FunctionalBufferMap<FunctionalBufferMap<Buffer>>) => {
      expect(destructs.size === 0, '_snapDestructs should be empty').be.true;
      expect(accountNow.stateRoot.equals(trie.root), 'account stateroot should be equal');
      expect(compareBufferMaps(accounts, accountMap), '_snapAccounts should be equal');
      let storageEqual = true;
      for (const [key, value] of storage) {
        const temp = storageMap.get(key);
        if (!compareBufferMaps(temp!, value)) {
          storageEqual = false;
          break;
        }
      }
      expect(storageEqual === true, '_snapStorage should be equal').be.true;
    };
    snapTree.callback = callback;
    await stateManager.commit();
  });

  it('should deleteAccount correctly', async () => {
    await stateManager.setStateRoot(stateManager._trie.root);
    await stateManager.checkpoint();
    await stateManager.putContractStorage(address, key1, value1);
    await stateManager.deleteAccount(address);
    const callback = (accounts: FunctionalBufferMap<Buffer>, destructs: FunctionalBufferSet, storage: FunctionalBufferMap<FunctionalBufferMap<Buffer>>) => {
      expect(accounts.has(kecAddress), 'account1 should be deleted in _snapAccounts').be.false;
      expect(storage.has(kecAddress), 'account1 should be deleted in _snapStorage').be.false;
      expect(destructs.has(kecAddress), 'account1 should be in _snapDestructs').be.true;
    };
    snapTree.callback = callback;
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
    const callback = (accounts: FunctionalBufferMap<Buffer>, destructs: FunctionalBufferSet, storage: FunctionalBufferMap<FunctionalBufferMap<Buffer>>) => {
      expect(compareBufferMaps(accountMap, accounts), '_snapAccounts should be equal').be.true;
      expect(destructs.has(kecAddress), 'account1 should be in _snapDestructs').be.true;
      expect(storage.size === 0, '_snapStorage should be empty').be.true;
    };
    snapTree.callback = callback;
    await stateManager.commit();
  });

  it('should revert correctly', async () => {
    await stateManager.setStateRoot(stateManager._trie.root);
    await stateManager.checkpoint();
    await stateManager.putAccount(address, account1);
    await stateManager.revert();
    expect(stateManager._snap, '_snap should be undifined');
    expect(stateManager._snapAccounts, '_snap should be undifined');
    expect(stateManager._snapDestructs, '_snap should be undifined');
    expect(stateManager._snapStorage, '_snap should be undifined');
  });
});
