import path from 'path';
import { expect, assert } from 'chai';
import { Address, BN, bufferToInt, setLengthLeft, toBuffer, bufferToHex } from 'ethereumjs-util';
import EVM from '@rei-network/vm/dist/evm/evm';
import TxContext from '@rei-network/vm/dist/evm/txContext';
import Message from '@rei-network/vm/dist/evm/message';
import { VM } from '@rei-network/vm';
import { SecureTrie as Trie } from '@rei-network/trie';
import { hexStringToBuffer } from '@rei-network/utils';
import { Common } from '@rei-network/common';
import { EVMWorkMode } from '@rei-network/vm/dist/evm/evm';
import { Blockchain } from '@rei-network/blockchain';
import { Block } from '@rei-network/structure';
import { createEncodingLevelDB, Database } from '@rei-network/database';
import { StateManager } from '../../src/stateManager';
import { StorageLoader } from '../../src/consensus/reimint/contracts/storageLoader';

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

const exampleContractByteCode = hexStringToBuffer(
  '60806040526001600055600160001b60015534801561001d57600080fd5b5060005b600a81101561011357600281908060018154018082558091505060019003906000526020600020016000909190919091505560038160001b908060018154018082558091505060019003906000526020600020016000909190919091505580600460008381526020019081526020016000208190555073ff96a3bff24da3d686fea7bd4beb5ccfd7868dde600560008360001b815260200190815260200160002060006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550808061010b90610152565b915050610021565b5061019a565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052601160045260246000fd5b6000819050919050565b600061015d82610148565b91507fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff820361018f5761018e610119565b5b600182019050919050565b603f806101a86000396000f3fe6080604052600080fdfea2646970667358221220ea34b24b55652db6ed4a46c2a3a255960ebb666083692e5a57e5042585696a4564736f6c63430008120033'
);

const exampleContractAddress = Address.fromString('0x0000000000000000000000000000000000001010');

describe('StorageLoader', () => {
  let storageLoader: StorageLoader;

  before(async () => {
    const dataDir = path.join(__dirname, '/test-dir');
    const common = new Common({ chain: 'rei-devnet' });
    common.setHardforkByBlockNumber(0);
    const [chaindb, chaindown] = createEncodingLevelDB(dataDir);
    const stateManager = new StateManager({
      common: common,
      trie: new Trie(chaindb)
    });

    const genesisBlock = Block.fromBlockData({ header: common.genesis() }, { common });
    const chain = new Blockchain({
      database: new Database(chaindb, common),
      common,
      genesisBlock,
      validateBlocks: false,
      validateConsensus: false,
      hardforkByHeadBlockNumber: true
    });

    const vm = new VM({
      common,
      stateManager,
      blockchain: chain,
      mode: EVMWorkMode.JS,
      exposed: chaindown.exposed
    });
    const evm = new EVM(vm, new TxContext(new BN(0), Address.zero()), genesisBlock);
    await evm.executeMessage(
      new Message({
        contractAddress: exampleContractAddress,
        to: exampleContractAddress,
        gasLimit: new BN('9223372036854775807'),
        data: exampleContractByteCode
      })
    );

    storageLoader = new StorageLoader(stateManager, exampleContractAddress);
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
