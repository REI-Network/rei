import path from 'path';
import { expect, assert } from 'chai';
import { Address, BN, setLengthLeft, toBuffer, bufferToHex } from 'ethereumjs-util';
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
import { AbiCoder } from '@ethersproject/abi';
const coder = new AbiCoder();
/**
 * This contract is used to test the storage loader.
 * 
//SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

contract test {
    struct S {
        address a;
        uint256 b;
    }

    uint256 t1 = 1;
    bytes32 t2 =
        0x0000000000000000000000000000000000000000000000000000000000000001;
    uint256[] t3;
    bytes32[] t4;
    mapping(uint256 => uint256) t5;
    mapping(bytes32 => address) t6;
    S s;
    S[] t7;
    mapping(uint256 => S) t8;
    bytes t9;
    bytes t10;
    string t11;
    address t12;
    mapping(address => S) t13;
    int256 t14;

    constructor() {
        s = S(0xFF96A3BfF24DA3d686FeA7BD4bEB5ccFD7868DdE, 321);
        t9 = "0x34bb5a21c262d943fe7e427ab98736982e2eacab59ac01f17855448712144faf852795c4745879a0c1cd8d393f760638f4209e4c7b684f4300edb2034bc08a91";
        t10 = "0x487a22cf8a60cbf9bd05f4765bddf4c74228c4b7f6340523b9add3e9c46e1de3c8ae29987238b9bd2fc729637331441a3c99721c071519851b32f152985e1bcf1eec0d15c4fc96fa4173";
        t11 = "123";
        t12 = 0xFF96A3BfF24DA3d686FeA7BD4bEB5ccFD7868DdE;
        for (uint256 i = 0; i < 10; i++) {
            t3.push(i);
            t4.push(bytes32(i));
            t5[i] = i;
            t6[bytes32(i)] = 0xFF96A3BfF24DA3d686FeA7BD4bEB5ccFD7868DdE;
            t7.push(S(0xFF96A3BfF24DA3d686FeA7BD4bEB5ccFD7868DdE, 321));
            t8[i] = S(0xFF96A3BfF24DA3d686FeA7BD4bEB5ccFD7868DdE, 321);
        }
        t13[0xFF96A3BfF24DA3d686FeA7BD4bEB5ccFD7868DdE] = S(
            0xFF96A3BfF24DA3d686FeA7BD4bEB5ccFD7868DdE,
            321
        );
        t13[0xEDfE730a3589De207c54dF997514a7f5A3683603] = S(
            0xEDfE730a3589De207c54dF997514a7f5A3683603,
            123
        );
        t14 = -123;
    }
}

*/

const exampleContractByteCode = hexStringToBuffer(
  '60806040526001600055600160001b60015534801561001d57600080fd5b50604051806040016040528073ff96a3bff24da3d686fea7bd4beb5ccfd7868dde73ffffffffffffffffffffffffffffffffffffffff168152602001610141815250600660008201518160000160006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550602082015181600101559050506040518060c0016040528060828152602001610ba060829139600a90816100dc9190610847565b506040518060c0016040528060968152602001610b0a60969139600b90816101049190610847565b506040518060400160405280600381526020017f3132330000000000000000000000000000000000000000000000000000000000815250600c90816101499190610974565b5073ff96a3bff24da3d686fea7bd4beb5ccfd7868dde600d60006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555060005b600a8110156103fb57600281908060018154018082558091505060019003906000526020600020016000909190919091505560038160001b908060018154018082558091505060019003906000526020600020016000909190919091505580600460008381526020019081526020016000208190555073ff96a3bff24da3d686fea7bd4beb5ccfd7868dde600560008360001b815260200190815260200160002060006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055506008604051806040016040528073ff96a3bff24da3d686fea7bd4beb5ccfd7868dde73ffffffffffffffffffffffffffffffffffffffff168152602001610141815250908060018154018082558091505060019003906000526020600020906002020160009091909190915060008201518160000160006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550602082015181600101555050604051806040016040528073ff96a3bff24da3d686fea7bd4beb5ccfd7868dde73ffffffffffffffffffffffffffffffffffffffff1681526020016101418152506009600083815260200190815260200160002060008201518160000160006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055506020820151816001015590505080806103f390610a75565b9150506101a2565b50604051806040016040528073ff96a3bff24da3d686fea7bd4beb5ccfd7868dde73ffffffffffffffffffffffffffffffffffffffff168152602001610141815250600e600073ff96a3bff24da3d686fea7bd4beb5ccfd7868dde73ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060008201518160000160006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555060208201518160010155905050604051806040016040528073edfe730a3589de207c54df997514a7f5a368360373ffffffffffffffffffffffffffffffffffffffff168152602001607b815250600e600073edfe730a3589de207c54df997514a7f5a368360373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060008201518160000160006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550602082015181600101559050507fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff85600f81905550610abd565b600081519050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b7f4e487b7100000000000000000000000000000000000000000000000000000000600052602260045260246000fd5b6000600282049050600182168061067857607f821691505b60208210810361068b5761068a610631565b5b50919050565b60008190508160005260206000209050919050565b60006020601f8301049050919050565b600082821b905092915050565b6000600883026106f37fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff826106b6565b6106fd86836106b6565b95508019841693508086168417925050509392505050565b6000819050919050565b6000819050919050565b600061074461073f61073a84610715565b61071f565b610715565b9050919050565b6000819050919050565b61075e83610729565b61077261076a8261074b565b8484546106c3565b825550505050565b600090565b61078761077a565b610792818484610755565b505050565b5b818110156107b6576107ab60008261077f565b600181019050610798565b5050565b601f8211156107fb576107cc81610691565b6107d5846106a6565b810160208510156107e4578190505b6107f86107f0856106a6565b830182610797565b50505b505050565b600082821c905092915050565b600061081e60001984600802610800565b1980831691505092915050565b6000610837838361080d565b9150826002028217905092915050565b610850826105f7565b67ffffffffffffffff81111561086957610868610602565b5b6108738254610660565b61087e8282856107ba565b600060209050601f8311600181146108b1576000841561089f578287015190505b6108a9858261082b565b865550610911565b601f1984166108bf86610691565b60005b828110156108e7578489015182556001820191506020850194506020810190506108c2565b868310156109045784890151610900601f89168261080d565b8355505b6001600288020188555050505b505050505050565b60008190508160005260206000209050919050565b601f82111561096f5761094081610919565b610949846106a6565b81016020851015610958578190505b61096c610964856106a6565b830182610797565b50505b505050565b61097d826105f7565b67ffffffffffffffff81111561099657610995610602565b5b6109a08254610660565b6109ab82828561092e565b600060209050601f8311600181146109de57600084156109cc578287015190505b6109d6858261082b565b865550610a3e565b601f1984166109ec86610919565b60005b82811015610a14578489015182556001820191506020850194506020810190506109ef565b86831015610a315784890151610a2d601f89168261080d565b8355505b6001600288020188555050505b505050505050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052601160045260246000fd5b6000610a8082610715565b91507fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff8203610ab257610ab1610a46565b5b600182019050919050565b603f80610acb6000396000f3fe6080604052600080fdfea2646970667358221220f0baeebc771971e854d6d4d783ef8aed9cfea3876ad960189217401d78742c9264736f6c6343000812003330783438376132326366386136306362663962643035663437363562646466346337343232386334623766363334303532336239616464336539633436653164653363386165323939383732333862396264326663373239363337333331343431613363393937323163303731353139383531623332663135323938356531626366316565633064313563346663393666613431373330783334626235613231633236326439343366653765343237616239383733363938326532656163616235396163303166313738353534343837313231343466616638353237393563343734353837396130633163643864333933663736303633386634323039653463376236383466343330306564623230333462633038613931'
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
    const storage = await storageLoader.loadStorageSlot(StorageLoader.indexToSlotIndex(new BN(0)));
    expect(new BN(storage).toString()).to.equal('1');
  });

  it('should load bytes32 type storage', async () => {
    const storage = await storageLoader.loadStorageSlot(StorageLoader.indexToSlotIndex(new BN(1)));
    assert(setLengthLeft(storage, 32).equals(toBuffer('0x0000000000000000000000000000000000000000000000000000000000000001')));
  });

  it('should load uint256[] type storage', async () => {
    const slot = StorageLoader.indexToSlotIndex(new BN(2));
    const length = new BN(await storageLoader.loadStorageSlot(slot));
    assert(length.eqn(10));
    for (let i = 0; i < 10; i++) {
      const elementSlot = storageLoader.getArrayStorageIndex(slot, new BN(i));
      expect(new BN(await storageLoader.loadStorageSlot(elementSlot)).toString()).to.equals(i.toString());
    }
  });

  it('should load bytes32[] type storage', async () => {
    const slot = StorageLoader.indexToSlotIndex(new BN(3));
    const length = new BN(await storageLoader.loadStorageSlot(slot));
    assert(length.eqn(10));
    for (let i = 0; i < 10; i++) {
      const elementSlot = storageLoader.getArrayStorageIndex(slot, new BN(i));
      assert(setLengthLeft(await storageLoader.loadStorageSlot(elementSlot), 32).equals(setLengthLeft(new BN(i).toBuffer(), 32)));
    }
  });

  it('should load mapping(uint256 => uint256) type storage', async () => {
    const slot = StorageLoader.indexToSlotIndex(new BN(4));
    for (let i = 0; i < 10; i++) {
      const elementSlot = storageLoader.getMappingStorageIndex(slot, new BN(i).toBuffer());
      expect(new BN(await storageLoader.loadStorageSlot(elementSlot)).toString()).to.equals(i.toString());
    }
  });

  it('should load mapping(bytes32 => address) type storage', async () => {
    const slot = StorageLoader.indexToSlotIndex(new BN(5));
    for (let i = 0; i < 10; i++) {
      const elementSlot = storageLoader.getMappingStorageIndex(slot, setLengthLeft(new BN(i).toBuffer(), 32));
      expect(bufferToHex(await storageLoader.loadStorageSlot(elementSlot))).to.equals('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde');
    }
  });

  it('should load struct type storage', async () => {
    const slot = StorageLoader.indexToSlotIndex(new BN(6));
    for (let i = 0; i < 2; i++) {
      const propertySlot = storageLoader.getStructStorageIndex(slot, new BN(i));
      if (i === 0) {
        expect(bufferToHex(await storageLoader.loadStorageSlot(propertySlot))).to.equals('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde');
      }
      if (i === 1) {
        expect(new BN(await storageLoader.loadStorageSlot(propertySlot)).toString()).to.equals('321');
      }
    }
  });

  it('should load struct[] type storage', async () => {
    const slot = StorageLoader.indexToSlotIndex(new BN(8));
    const length = new BN(await storageLoader.loadStorageSlot(slot));
    const propertyCount = 2;
    assert(length.eqn(10));
    for (let i = 0; i < 10; i++) {
      const elementSlot = storageLoader.getArrayStorageIndex(slot, new BN(i * propertyCount));
      for (let j = 0; j < 2; j++) {
        const propertySlot = storageLoader.getStructStorageIndex(elementSlot, new BN(j));
        if (j === 0) {
          expect(bufferToHex(await storageLoader.loadStorageSlot(propertySlot))).to.equals('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde');
        }
        if (j === 1) {
          expect(new BN(await storageLoader.loadStorageSlot(propertySlot)).toString()).to.equals('321');
        }
      }
    }
  });

  it('should load mapping(uint256 => struct) type storage', async () => {
    const slot = StorageLoader.indexToSlotIndex(new BN(9));
    for (let i = 0; i < 10; i++) {
      const elementSlot = storageLoader.getMappingStorageIndex(slot, new BN(i).toBuffer());
      for (let j = 0; j < 2; j++) {
        const propertySlot = storageLoader.getStructStorageIndex(elementSlot, new BN(j));
        if (j === 0) {
          expect(bufferToHex(await storageLoader.loadStorageSlot(propertySlot))).to.equals('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde');
        }
        if (j === 1) {
          expect(new BN(await storageLoader.loadStorageSlot(propertySlot)).toString()).to.equals('321');
        }
      }
    }
  });

  it('should load bytes type storage', async () => {
    const slot = StorageLoader.indexToSlotIndex(new BN(10));
    const storage = await storageLoader.loadBytesOrString(slot);
    expect(storage.toString()).to.equals('0x34bb5a21c262d943fe7e427ab98736982e2eacab59ac01f17855448712144faf852795c4745879a0c1cd8d393f760638f4209e4c7b684f4300edb2034bc08a91');
    const slot1 = StorageLoader.indexToSlotIndex(new BN(11));
    const storage1 = await storageLoader.loadBytesOrString(slot1);
    expect(storage1.toString()).to.equals('0x487a22cf8a60cbf9bd05f4765bddf4c74228c4b7f6340523b9add3e9c46e1de3c8ae29987238b9bd2fc729637331441a3c99721c071519851b32f152985e1bcf1eec0d15c4fc96fa4173');
  });

  it('should load string type storage', async () => {
    const slot = StorageLoader.indexToSlotIndex(new BN(12));
    const storage = await storageLoader.loadBytesOrString(slot);
    expect(storage.toString()).to.equals('123');
  });

  it('should load address type storage', async () => {
    const slot = StorageLoader.indexToSlotIndex(new BN(13));
    const storage = await storageLoader.loadStorageSlot(slot);
    expect(bufferToHex(storage)).to.equals('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde');
  });

  it('should load mapping(address => struct) type storage ', async () => {
    const slot = StorageLoader.indexToSlotIndex(new BN(14));
    const elementSlot1 = storageLoader.getMappingStorageIndex(slot, toBuffer('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde'));
    const propertySlot1 = storageLoader.getStructStorageIndex(elementSlot1, new BN(0));
    const propertySlot2 = storageLoader.getStructStorageIndex(elementSlot1, new BN(1));
    expect(bufferToHex(await storageLoader.loadStorageSlot(propertySlot1))).to.equals('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde');
    expect(new BN(await storageLoader.loadStorageSlot(propertySlot2)).toString()).to.equals('321');

    const elementSlot2 = storageLoader.getMappingStorageIndex(slot, toBuffer('0xedfe730a3589de207c54df997514a7f5a3683603'));
    const propertySlot3 = storageLoader.getStructStorageIndex(elementSlot2, new BN(0));
    const propertySlot4 = storageLoader.getStructStorageIndex(elementSlot2, new BN(1));
    expect(bufferToHex(await storageLoader.loadStorageSlot(propertySlot3))).to.equals('0xedfe730a3589de207c54df997514a7f5a3683603');
    expect(new BN(await storageLoader.loadStorageSlot(propertySlot4)).toString()).to.equals('123');
  });

  it('should load int256 type storage', async () => {
    const slot = StorageLoader.indexToSlotIndex(new BN(15));
    const storage = await storageLoader.loadStorageSlot(slot);
    expect(new BN(coder.decode(['int256'], storage)[0].toString()).toString()).to.equals('-123');
  });
});
