import crypto from 'crypto';
import { expect } from 'chai';
import { Common } from '@rei-network/common';
import { StateManager, StakingAccount } from '../../src/stateManager';
import { Snapshot, SnapshotTree } from '../../src/stateManager/types';
import { FunctionalBufferMap, FunctionalBufferSet } from '@rei-network/utils';
import { Address, BN, keccak256, unpadBuffer } from 'ethereumjs-util';
import { encode } from 'rlp';
import { Trie } from 'merkle-patricia-tree/dist/baseTrie';

class MockSnap implements Snapshot {
  _root: Buffer;
  constructor(root: Buffer) {
    this._root = root;
  }

  parent(): Snapshot {
    return new MockSnap(Buffer.from([]));
  }

  root() {
    return this._root;
  }

  account(hash: Buffer) {
    return StakingAccount.fromRlpSlimSerializedAccount(hash);
  }

  accountRLP(hash: Buffer): Buffer {
    return StakingAccount.fromRlpSlimSerializedAccount(hash).serialize();
  }

  update(blockRoot: Buffer, destructs: Map<Buffer, Buffer>, accounts: Map<Buffer, Buffer>, storage: Map<Buffer, Buffer>): Snapshot {
    return new MockSnap(Buffer.from([]));
  }
}

class MockSnapTree implements SnapshotTree {
  constructor() {}

  snapshot(blockRoot: Buffer): Snapshot {
    return new MockSnap(blockRoot);
  }

  cap(root: Buffer, layers: number): Promise<void> {
    return new Promise((resolve) => {
      resolve();
    });
  }

  update(root: Buffer, parent: Buffer, accounts: FunctionalBufferMap<Buffer>, destructs: FunctionalBufferSet, storage: FunctionalBufferMap<FunctionalBufferMap<Buffer>>): Promise<void> {
    return new Promise((resolve) => {
      resolve();
    });
  }
}

function compareMaps(map1: Map<any, any>, map2: Map<any, any>) {
  let testVal: any;
  if (map1.size != map2.size) {
    return false;
  }
  for (let [key, val] of map1) {
    testVal = map2.get(key);
    if (testVal !== val || (testVal === undefined && !map2.has(key))) {
      return false;
    }
  }
  return true;
}

function compareSets(set1: Set<any>, set2: Set<any>) {
  if (set1.size != set2.size) {
    return false;
  }
  for (let element of set1) {
    if (!set2.has(element)) {
      return false;
    }
  }
  return true;
}

async function newRoot(limit: number): Promise<Buffer> {
  const trie = new Trie();
  for (let i = 0; i < limit; i++) {
    await trie.put(crypto.randomBytes(32), crypto.randomBytes(32));
  }
  return trie.root;
}

describe('StateManager', () => {
  const common = new Common({ chain: 'rei-testnet' });
  common.setHardforkByBlockNumber(0);

  const SnapTreeInstance = new MockSnapTree();
  const address1 = Address.fromString('0xAE0c03FdeDB61021272922F7804505CEE2C12c78');
  const account1 = StakingAccount.fromAccountData({ balance: new BN(12) });
  const account2 = StakingAccount.fromAccountData({ balance: new BN(34) });
  const key1 = crypto.randomBytes(32);
  const value1 = crypto.randomBytes(32);
  let stateManager: StateManager;

  before(async () => {
    stateManager = new StateManager({
      common,
      snapsTree: SnapTreeInstance,
      root: await newRoot(100)
    });
  });

  it('should checkpoint correctly', async () => {
    const accessedObjectListLengthBefore = stateManager._accessedSnapObjectsList.length;
    expect(accessedObjectListLengthBefore == 0, 'ObjectList length should be equal').be.true;
    await stateManager.checkpoint();
    const accessedObjectListLengthAfter = stateManager._accessedSnapObjectsList.length;
    expect(accessedObjectListLengthAfter == 1, 'ObjectList length should be equal').be.true;
  });

  it('should putAccount correctly', async () => {
    await stateManager.checkpoint();
    await stateManager.putAccount(address1, account1);
    const account = stateManager._snapAccounts?.get(keccak256(address1.buf));
    expect(account?.equals(account1.slimSerialize()), 'Account should be equal').be.true;
  });

  it('should putContractStorage correctly', async () => {
    await stateManager.putContractStorage(address1, key1, value1);
    const storage = stateManager._snapStorage?.get(keccak256(address1.buf));
    const value = storage?.get(keccak256(key1));
    expect(value?.equals(encode(unpadBuffer(value1))), 'Storage should be added').be.true;
  });

  it('should deleteAccount correctly', async () => {
    await stateManager.deleteAccount(address1);
    expect(stateManager._snapDestructs?.has(keccak256(address1.buf)), 'Account should be deleted').be.true;
    expect(stateManager._snapAccounts?.has(keccak256(address1.buf)), 'Account should be deleted').be.false;
    expect(stateManager._snapStorage?.has(keccak256(address1.buf)), 'Account should be deleted').be.false;
  });

  it('should commit correctly', async () => {
    const accessedObjectListLengthBefore = stateManager._accessedSnapObjectsList.length;
    expect(accessedObjectListLengthBefore == 2, 'ObjectList length should be equal').be.true;
    await stateManager.commit();
    const accessedObjectListLengthAfter = stateManager._accessedSnapObjectsList.length;
    expect(accessedObjectListLengthAfter == 1, 'ObjectList length should be equal').be.true;
    const lastObject = stateManager._accessedSnapObjectsList[0];
    expect(compareMaps(lastObject.snapAccounts!, new FunctionalBufferMap<Buffer>()), 'snapAccounts map should be equal').be.true;
    expect(compareSets(lastObject.snapDestructs!, new FunctionalBufferSet()), 'snapDestruct map should be equal').be.true;
    expect(lastObject.snapStroge?.size == 0, 'snapStorage be equal').be.true;
  });

  it('should create a Account correctly', async () => {
    await stateManager.checkpoint();
    const accessedObjectListLength = stateManager._accessedSnapObjectsList.length;
    expect(accessedObjectListLength == 2, 'ObjectList length should be equal').be.true;
    const lastObject = stateManager._accessedSnapObjectsList[stateManager._accessedSnapObjectsList.length - 1];
    expect(compareMaps(lastObject.snapAccounts!, stateManager._snapAccounts!), 'snapAccounts map should be equal').be.true;
    expect(compareSets(lastObject.snapDestructs!, stateManager._snapDestructs!), 'snapDestruct map should be equal').be.true;
    let storage = true;
    for (let [key, value] of stateManager._snapStorage!) {
      let temp = lastObject.snapStroge?.get(key);
      if (!compareMaps(temp!, value)) {
        storage = false;
        break;
      }
    }
    expect(storage == true, 'snapStorage should be equal').be.true;
    await stateManager.putAccount(address1, account2);
    await stateManager.putContractStorage(address1, crypto.randomBytes(32), crypto.randomBytes(32));
    expect(stateManager._snapDestructs?.has(keccak256(address1.buf)), 'Account should be created').be.true;
    expect(stateManager._snapAccounts?.has(keccak256(address1.buf)), 'Account should be created').be.true;
    expect(stateManager._snapStorage?.has(keccak256(address1.buf)), 'Account should be created').be.true;
  });

  it('should revert correctly', async () => {
    const accessedObjectListLength = stateManager._accessedSnapObjectsList.length;
    expect(accessedObjectListLength == 2, 'ObjectList length should be equal').be.true;
    await stateManager.revert();
    const accessedObjectListLengthAfter = stateManager._accessedSnapObjectsList.length;
    expect(accessedObjectListLengthAfter == 1, 'ObjectList length should be equal').be.true;
    expect(stateManager._snapDestructs?.has(keccak256(address1.buf)), 'Account should in destruct set').be.true;
    expect(stateManager._snapAccounts?.has(keccak256(address1.buf)), 'Account should not in accounts map').be.false;
    expect(stateManager._snapStorage?.has(keccak256(address1.buf)), 'Account should not in storage map').be.false;
    await stateManager.revert();
    const accessedObjectListLengthFinal = stateManager._accessedSnapObjectsList.length;
    expect(accessedObjectListLengthFinal == 0, 'ObjectList should be empty');
    expect(stateManager._snapDestructs?.size == 0, 'Destruct set should be empty').be.true;
    expect(stateManager._snapAccounts?.size == 0, 'Account map should be empty').be.true;
    expect(stateManager._snapStorage?.size == 0, 'Storage map should be empty').be.true;
  });
});
