import crypto from 'crypto';
import { expect } from 'chai';
import { VM } from '@rei-network/vm';
import { Common } from '@rei-network/common';
import { Blockchain } from '@rei-network/blockchain';
import { Database } from '@rei-network/database';
import { Block } from '@rei-network/structure';
import { StateManager, StakingAccount } from '../../src/stateManager';
import { Snapshot, SnapshotTree } from '../../src/stateManager/types';
import { FunctionalBufferMap } from '@rei-network/utils';
import { Address, BN } from 'ethereumjs-util';

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

  cap(root: Buffer, layers: number): void {}

  update(root: Buffer, parent: Buffer, accounts: FunctionalBufferMap<Buffer>, destructs: FunctionalBufferMap<Buffer>, storage: FunctionalBufferMap<FunctionalBufferMap<Buffer>>): void {}
}

function compareMaps(map1: Map<any, any>, map2: Map<any, any>) {
  let testVal: any;
  if (map1.size != map2.size) {
    return false;
  }
  for (var [key, val] of map1) {
    testVal = map2.get(key);
    if (testVal !== val || (testVal === undefined && !map2.has(key))) {
      return false;
    }
  }
  return true;
}

describe('StateManager', () => {
  const level = require('level-mem');

  const common = new Common({ chain: 'rei-devnet' });
  common.setHardforkByBlockNumber(0);

  const db = new Database(level(), common);

  const genesis = Block.fromBlockData({ header: common.genesis() }, { common });

  const blockchain = new Blockchain({
    database: db,
    common,
    genesisBlock: genesis,
    validateBlocks: false,
    validateConsensus: false,
    hardforkByHeadBlockNumber: true
  });

  const testSnapTreeInstance = new MockSnapTree();
  const stateManager = new StateManager({
    common,
    snapsTree: testSnapTreeInstance,
    root: Buffer.from('123456')
  });

  const vm = new VM({
    stateManager: stateManager,
    blockchain: blockchain,
    common: common
  });

  const address1 = Address.fromString('0xAE0c03FdeDB61021272922F7804505CEE2C12c78');
  const account1 = StakingAccount.fromAccountData({ balance: new BN(12) });
  const account2 = StakingAccount.fromAccountData({ balance: new BN(34) });
  const key1 = crypto.randomBytes(32);
  const value1 = crypto.randomBytes(32);

  it('should checkpoint correctly', async () => {
    const accessedMapListLengthBefore = stateManager._accessedMapList.length;
    expect(accessedMapListLengthBefore == 0, 'MapList length should be equal').be.true;
    await stateManager.checkpoint();
    const accessedMapListLengthAfter = stateManager._accessedMapList.length;
    expect(accessedMapListLengthAfter == 1, 'MapList length should be equal').be.true;
  });

  it('should putAccount correctly', async () => {
    await stateManager.checkpoint();
    await stateManager.putAccount(address1, account1);
    const account = stateManager._snapAccounts?.get(address1.buf);
    expect(account?.equals(account1.slimSerialize()), 'Account should be equal').be.true;
  });

  it('should putContractStorage correctly', async () => {
    await stateManager.putContractStorage(address1, key1, value1);
    const storage = stateManager._snapStorage?.get(address1.buf);
    const value = storage?.get(key1);
    expect(value?.equals(value1), 'Storage should be added').be.true;
  });

  it('should deleteAccount correctly', async () => {
    await stateManager.deleteAccount(address1);
    expect(stateManager._snapDestructs?.has(address1.buf), 'Account should be deleted').be.true;
    expect(stateManager._snapAccounts?.has(address1.buf), 'Account should be deleted').be.false;
    expect(stateManager._snapStorage?.has(address1.buf), 'Account should be deleted').be.false;
  });

  it('should commit correctly', async () => {
    const accessedMapListLengthBefore = stateManager._accessedMapList.length;
    expect(accessedMapListLengthBefore == 2, 'MapList length should be equal').be.true;
    await stateManager.commit();
    const accessedMapListLengthAfter = stateManager._accessedMapList.length;
    expect(accessedMapListLengthAfter == 1, 'MapList length should be equal').be.true;
    const lastMapList = stateManager._accessedMapList[0];
    expect(compareMaps(lastMapList.snapAccounts, new FunctionalBufferMap<Buffer>()), 'snapAccounts map should be equal').be.true;
    expect(compareMaps(lastMapList.snapDestructs, new FunctionalBufferMap<Buffer>()), 'snapDestruct map should be equal').be.true;
    expect(lastMapList.snapStroge.size == 0, 'snapStorage be equal').be.true;
  });

  it('should create a Account correctly', async () => {
    await stateManager.checkpoint();
    const accessedMapListLength = stateManager._accessedMapList.length;
    expect(accessedMapListLength == 2, 'MapList length should be equal').be.true;
    const lastMapList = stateManager._accessedMapList[stateManager._accessedMapList.length - 1];
    expect(compareMaps(lastMapList.snapAccounts, stateManager._snapAccounts!), 'snapAccounts map should be equal').be.true;
    expect(compareMaps(lastMapList.snapDestructs, stateManager._snapDestructs!), 'snapDestruct map should be equal').be.true;
    let storage = true;
    for (let [key, value] of stateManager._snapStorage!) {
      let temp = lastMapList.snapStroge.get(key);
      if (!compareMaps(temp!, value)) {
        storage = false;
        break;
      }
    }
    expect(storage == true, 'snapStorage should be equal').be.true;
    await stateManager.putAccount(address1, account2);
    await stateManager.putContractStorage(address1, crypto.randomBytes(32), crypto.randomBytes(32));
    expect(stateManager._snapDestructs?.has(address1.buf), 'Account should be created').be.true;
    expect(stateManager._snapAccounts?.has(address1.buf), 'Account should be created').be.true;
    expect(stateManager._snapStorage?.has(address1.buf), 'Account should be created').be.true;
  });

  it('should revert correctly', async () => {
    const accessedMapListLength = stateManager._accessedMapList.length;
    expect(accessedMapListLength == 2, 'MapList length should be equal').be.true;
    await stateManager.revert();
    const accessedMapListLengthAfter = stateManager._accessedMapList.length;
    expect(accessedMapListLengthAfter == 1, 'MapList length should be equal').be.true;
    expect(stateManager._snapDestructs?.has(address1.buf), 'Account should in destruct map').be.true;
    expect(stateManager._snapAccounts?.has(address1.buf), 'Account should not in accounts map').be.false;
    expect(stateManager._snapStorage?.has(address1.buf), 'Account should not in storage map').be.false;
    await stateManager.revert();
    const accessedMapListLengthFinal = stateManager._accessedMapList.length;
    expect(accessedMapListLengthFinal == 0, 'MapList should be empty');
    expect(stateManager._snapDestructs?.size == 0, 'Destruct map should be empty').be.true;
    expect(stateManager._snapAccounts?.size == 0, 'Account map should be empty').be.true;
    expect(stateManager._snapStorage?.size == 0, 'Storage map should be empty').be.true;
  });
});
