import path from 'path';
import { expect } from 'chai';
import { Address, BN, bufferToInt, setLengthLeft, toBuffer, bufferToHex } from 'ethereumjs-util';
import { SecureTrie as Trie } from '@rei-network/trie';
import { Common } from '@rei-network/common';
import { createEncodingLevelDB, Database } from '@rei-network/database';
import { StateManager } from '../../src';
import { StorageLoader } from '../../src/consensus/reimint/contracts/storageLoader';
import { assert } from 'console';
/**
 * This contract is used to test the storage loader.
 * 
//SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

contract test {
    uint256 t1 = 1;
    bytes32 t2 =
        0x0000000000000000000000000000000000000000000000000000000000000001;
    uint256[] t3;
    bytes32[] t4;
    mapping(uint256 => uint256) t5;
    mapping(bytes32 => address) t6;

    constructor() {
        for (uint256 i = 0; i < 10; i++) {
            t3.push(i);
            t4.push(bytes32(i));
            t5[i] = i;
            t6[bytes32(i)] = 0xFF96A3BfF24DA3d686FeA7BD4bEB5ccFD7868DdE;
        }
    }
}
*/

describe('StorageLoader', () => {
  let storageLoader: StorageLoader;

  before(async () => {
    const height = 100;
    const contractAddress = '0x094319890280E2c6430091FEc44822540229ca62';
    const common = new Common({ chain: 'rei-devnet' });
    common.setHardforkByBlockNumber(0);
    const chaindb = createEncodingLevelDB(path.join(__dirname, 'chaindb'))[0];
    const db = new Database(chaindb, common);
    const stateManager = new StateManager({ common: common, trie: new Trie(chaindb) });
    await stateManager.setStateRoot((await db.getBlock(height)).header.stateRoot);
    storageLoader = new StorageLoader(stateManager, Address.fromString(contractAddress));
  });

  it('should load uint256 type storage', async () => {
    const storage = await storageLoader.loadStorageSlot(new BN(0));
    expect(bufferToInt(storage)).to.equal(1);
  });

  it('should load bytes32 type storage', async () => {
    const storage = await storageLoader.loadStorageSlot(new BN(1));
    assert(setLengthLeft(storage, 32).equals(toBuffer('0x0000000000000000000000000000000000000000000000000000000000000001')));
  });

  it('should load uint256[] type storage', async () => {
    const storage = storageLoader.loadUint256Array(new BN(2));
    assert((await storage.length()).eqn(10));
    for (let i = 0; i < 10; i++) {
      expect(bufferToInt(await storage.at(new BN(i)))).to.equals(i);
    }
  });

  it('should load bytes32[] type storage', async () => {
    const storage = storageLoader.loadUint256Array(new BN(3));
    assert((await storage.length()).eqn(10));
    for (let i = 0; i < 10; i++) {
      assert(setLengthLeft(await storage.at(new BN(i)), 32).equals(setLengthLeft(new BN(i).toBuffer(), 32)));
    }
  });

  it('should load mapping(uint256 => uint256) type storage', async () => {
    const storage = storageLoader.loadMap(new BN(4));
    for (let i = 0; i < 10; i++) {
      expect(bufferToInt(await storage.get(new BN(i).toBuffer()))).to.equals(i);
    }
  });

  it('should load mapping(bytes32 => address) type storage', async () => {
    const storage = storageLoader.loadMap(new BN(5));
    for (let i = 0; i < 10; i++) {
      expect(bufferToHex(await storage.get(new BN(i).toBuffer()))).to.equals('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde');
    }
  });
});
