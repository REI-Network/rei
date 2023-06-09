import path from 'path';
import crypto from 'crypto';
import { expect, assert } from 'chai';
import { Address, BN, toBuffer, bufferToHex } from 'ethereumjs-util';
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
import { StorageLoader } from '../../src/reimint/contracts/storageLoader';
import { encode } from '../../src/reimint/contracts/utils';

/**
 * This contract is used to test the storage loader.
 * 
//SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

contract StorageLoaderTestContract {
    struct S {
        address a;
        int256 b;
    }

    bool t0;
    int256 t1;
    uint256 t2;
    bytes32 t3;
    address t4;

    S t5;
    S[] public t6;

    mapping(address => S) t7;
    mapping(bytes32 => bool) t8;

    string t9;
    bytes t10;

    function setBool(bool _bool) public {
        t0 = _bool;
    }

    function setInt256(int256 _int) public {
        t1 = _int;
    }

    function setUint256(uint256 _uint) public {
        t2 = _uint;
    }

    function setBytes32(bytes32 _bytes32) public {
        t3 = _bytes32;
    }

    function setAddress(address _address) public {
        t4 = _address;
    }

    function setStruct(address _addr, int256 _int) public {
        t5 = S(_addr, _int);
    }

    function setStructArray(address _addr, int256 _int) public {
        t6.push(S(_addr, _int));
    }

    function setMapping1(address _addr1, address _addr2, int256 _int) public {
        t7[_addr1] = S(_addr2, _int);
    }

    function setMapping2(bytes32 _bytes32, bool _bool) public {
        t8[_bytes32] = _bool;
    }

    function setString(string memory _string) public {
        t9 = _string;
    }

    function setBytes(bytes memory _bytes) public {
        t10 = _bytes;
    }
}

*/

const exampleContractByteCode = hexStringToBuffer(
  '608060405234801561001057600080fd5b50610f51806100206000396000f3fe608060405234801561001057600080fd5b50600436106100b45760003560e01c8063c2b12a7311610071578063c2b12a7314610176578063d2282dc514610192578063da359dc8146101ae578063e30081a0146101ca578063e6c83a8a146101e6578063ea04812f14610202576100b4565b80630b703af3146100b95780631e26fd33146100ea5780632b2cb979146101065780637fcaf666146101225780639384b62b1461013e578063a53b1c1e1461015a575b600080fd5b6100d360048036038101906100ce9190610584565b61021e565b6040516100e192919061060b565b60405180910390f35b61010460048036038101906100ff919061066c565b610272565b005b610120600480360381019061011b91906106f1565b61028e565b005b61013c60048036038101906101379190610877565b610313565b005b610158600480360381019061015391906108f6565b610326565b005b610174600480360381019061016f9190610936565b610355565b005b610190600480360381019061018b9190610963565b61035f565b005b6101ac60048036038101906101a79190610584565b610369565b005b6101c860048036038101906101c39190610a31565b610373565b005b6101e460048036038101906101df9190610a7a565b610386565b005b61020060048036038101906101fb9190610aa7565b6103ca565b005b61021c600480360381019061021791906106f1565b61048d565b005b6007818154811061022e57600080fd5b90600052602060002090600202016000915090508060000160009054906101000a900473ffffffffffffffffffffffffffffffffffffffff16908060010154905082565b806000806101000a81548160ff02191690831515021790555050565b60405180604001604052808373ffffffffffffffffffffffffffffffffffffffff16815260200182815250600560008201518160000160006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550602082015181600101559050505050565b80600a90816103229190610d11565b5050565b806009600084815260200190815260200160002060006101000a81548160ff0219169083151502179055505050565b8060018190555050565b8060038190555050565b8060028190555050565b80600b90816103829190610e49565b5050565b80600460006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555050565b60405180604001604052808373ffffffffffffffffffffffffffffffffffffffff16815260200182815250600860008573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060008201518160000160006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555060208201518160010155905050505050565b600760405180604001604052808473ffffffffffffffffffffffffffffffffffffffff16815260200183815250908060018154018082558091505060019003906000526020600020906002020160009091909190915060008201518160000160006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055506020820151816001015550505050565b6000604051905090565b600080fd5b600080fd5b6000819050919050565b6105618161054e565b811461056c57600080fd5b50565b60008135905061057e81610558565b92915050565b60006020828403121561059a57610599610544565b5b60006105a88482850161056f565b91505092915050565b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b60006105dc826105b1565b9050919050565b6105ec816105d1565b82525050565b6000819050919050565b610605816105f2565b82525050565b600060408201905061062060008301856105e3565b61062d60208301846105fc565b9392505050565b60008115159050919050565b61064981610634565b811461065457600080fd5b50565b60008135905061066681610640565b92915050565b60006020828403121561068257610681610544565b5b600061069084828501610657565b91505092915050565b6106a2816105d1565b81146106ad57600080fd5b50565b6000813590506106bf81610699565b92915050565b6106ce816105f2565b81146106d957600080fd5b50565b6000813590506106eb816106c5565b92915050565b6000806040838503121561070857610707610544565b5b6000610716858286016106b0565b9250506020610727858286016106dc565b9150509250929050565b600080fd5b600080fd5b6000601f19601f8301169050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b6107848261073b565b810181811067ffffffffffffffff821117156107a3576107a261074c565b5b80604052505050565b60006107b661053a565b90506107c2828261077b565b919050565b600067ffffffffffffffff8211156107e2576107e161074c565b5b6107eb8261073b565b9050602081019050919050565b82818337600083830152505050565b600061081a610815846107c7565b6107ac565b90508281526020810184848401111561083657610835610736565b5b6108418482856107f8565b509392505050565b600082601f83011261085e5761085d610731565b5b813561086e848260208601610807565b91505092915050565b60006020828403121561088d5761088c610544565b5b600082013567ffffffffffffffff8111156108ab576108aa610549565b5b6108b784828501610849565b91505092915050565b6000819050919050565b6108d3816108c0565b81146108de57600080fd5b50565b6000813590506108f0816108ca565b92915050565b6000806040838503121561090d5761090c610544565b5b600061091b858286016108e1565b925050602061092c85828601610657565b9150509250929050565b60006020828403121561094c5761094b610544565b5b600061095a848285016106dc565b91505092915050565b60006020828403121561097957610978610544565b5b6000610987848285016108e1565b91505092915050565b600067ffffffffffffffff8211156109ab576109aa61074c565b5b6109b48261073b565b9050602081019050919050565b60006109d46109cf84610990565b6107ac565b9050828152602081018484840111156109f0576109ef610736565b5b6109fb8482856107f8565b509392505050565b600082601f830112610a1857610a17610731565b5b8135610a288482602086016109c1565b91505092915050565b600060208284031215610a4757610a46610544565b5b600082013567ffffffffffffffff811115610a6557610a64610549565b5b610a7184828501610a03565b91505092915050565b600060208284031215610a9057610a8f610544565b5b6000610a9e848285016106b0565b91505092915050565b600080600060608486031215610ac057610abf610544565b5b6000610ace868287016106b0565b9350506020610adf868287016106b0565b9250506040610af0868287016106dc565b9150509250925092565b600081519050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052602260045260246000fd5b60006002820490506001821680610b4c57607f821691505b602082108103610b5f57610b5e610b05565b5b50919050565b60008190508160005260206000209050919050565b60006020601f8301049050919050565b600082821b905092915050565b600060088302610bc77fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff82610b8a565b610bd18683610b8a565b95508019841693508086168417925050509392505050565b6000819050919050565b6000610c0e610c09610c048461054e565b610be9565b61054e565b9050919050565b6000819050919050565b610c2883610bf3565b610c3c610c3482610c15565b848454610b97565b825550505050565b600090565b610c51610c44565b610c5c818484610c1f565b505050565b5b81811015610c8057610c75600082610c49565b600181019050610c62565b5050565b601f821115610cc557610c9681610b65565b610c9f84610b7a565b81016020851015610cae578190505b610cc2610cba85610b7a565b830182610c61565b50505b505050565b600082821c905092915050565b6000610ce860001984600802610cca565b1980831691505092915050565b6000610d018383610cd7565b9150826002028217905092915050565b610d1a82610afa565b67ffffffffffffffff811115610d3357610d3261074c565b5b610d3d8254610b34565b610d48828285610c84565b600060209050601f831160018114610d7b5760008415610d69578287015190505b610d738582610cf5565b865550610ddb565b601f198416610d8986610b65565b60005b82811015610db157848901518255600182019150602085019450602081019050610d8c565b86831015610dce5784890151610dca601f891682610cd7565b8355505b6001600288020188555050505b505050505050565b600081519050919050565b60008190508160005260206000209050919050565b601f821115610e4457610e1581610dee565b610e1e84610b7a565b81016020851015610e2d578190505b610e41610e3985610b7a565b830182610c61565b50505b505050565b610e5282610de3565b67ffffffffffffffff811115610e6b57610e6a61074c565b5b610e758254610b34565b610e80828285610e03565b600060209050601f831160018114610eb35760008415610ea1578287015190505b610eab8582610cf5565b865550610f13565b601f198416610ec186610dee565b60005b82811015610ee957848901518255600182019150602085019450602081019050610ec4565b86831015610f065784890151610f02601f891682610cd7565b8355505b6001600288020188555050505b50505050505056fea26469706673582212206f420920952f489cec94076653f4421dcb7bb4bcaf1fb683d2f762e084e0bcc964736f6c63430008120033'
);

const exampleContractAddress = Address.fromString('0x0000000000000000000000000000000000001010');

const selectors = new Map<string, Buffer>([
  ['setBool', toBuffer('0x1e26fd33')],
  ['setInt256', toBuffer('0xa53b1c1e')],
  ['setUint256', toBuffer('0xd2282dc5')],
  ['setBytes32', toBuffer('0xc2b12a73')],
  ['setAddress', toBuffer('0xe30081a0')],
  ['setStruct', toBuffer('0x2b2cb979')],
  ['setStructArray', toBuffer('0xea04812f')],
  ['setMapping1', toBuffer('0xe6c83a8a')],
  ['setMapping2', toBuffer('0x9384b62b')],
  ['setString', toBuffer('0x7fcaf666')],
  ['setBytes', toBuffer('0xda359dc8')]
]);

describe('StorageLoader', () => {
  let storageLoader: StorageLoader;
  let evm: EVM;
  let common: Common;

  before(async () => {
    const dataDir = path.join(__dirname, '/test-dir');
    common = new Common({ chain: 'rei-devnet' });
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
    evm = new EVM(vm, new TxContext(new BN(0), Address.zero()), genesisBlock);
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

  async function contractCall(data: Buffer) {
    await evm.executeMessage(
      new Message({
        caller: Address.fromString(common.param('vm', 'scaddr')),
        to: exampleContractAddress,
        gasLimit: new BN('9223372036854775807'),
        value: 0,
        isStatic: false,
        data
      })
    );
  }

  it('should not decode storage slot  which the length is less than 32 bytes', async () => {
    try {
      StorageLoader.decode(Buffer.from([0]), 'uint256');
    } catch (error) {
      expect((error as any).message).to.equal('slotStorage length is not 32');
    }
  });

  it('should load bool type storage', async () => {
    await contractCall(Buffer.concat([selectors.get('setBool')!, encode(['bool'], [true])]));
    const storage = await storageLoader.loadStorageSlot(StorageLoader.indexToSlotIndex(new BN(0)));
    expect(StorageLoader.decode(storage, 'bool')).to.equal(true);
    await contractCall(Buffer.concat([selectors.get('setBool')!, encode(['bool'], [false])]));
    const storage1 = await storageLoader.loadStorageSlot(StorageLoader.indexToSlotIndex(new BN(0)));
    expect(StorageLoader.decode(storage1, 'bool')).to.equal(false);
  });

  it('should load int256 type storage', async () => {
    await contractCall(Buffer.concat([selectors.get('setInt256')!, encode(['int256'], [1])]));
    const storage = await storageLoader.loadStorageSlot(StorageLoader.indexToSlotIndex(new BN(1)));
    expect(StorageLoader.decode(storage, 'int256').toString()).to.equal('1');
    await contractCall(Buffer.concat([selectors.get('setInt256')!, encode(['int256'], [-1])]));
    const storage1 = await storageLoader.loadStorageSlot(StorageLoader.indexToSlotIndex(new BN(1)));
    expect(StorageLoader.decode(storage1, 'int256').toString()).to.equal('-1');
  });

  it('should load uint256 type storage', async () => {
    await contractCall(Buffer.concat([selectors.get('setUint256')!, encode(['uint256'], [1])]));
    const storage = await storageLoader.loadStorageSlot(StorageLoader.indexToSlotIndex(new BN(2)));
    expect(StorageLoader.decode(storage, 'uint256').toString()).to.equal('1');
  });

  it('should load bytes32 type storage', async () => {
    await contractCall(Buffer.concat([selectors.get('setBytes32')!, encode(['bytes32'], ['0x0000000000000000000000000000000000000000000000000000000000000001'])]));
    const storage = await storageLoader.loadStorageSlot(StorageLoader.indexToSlotIndex(new BN(3)));
    assert((StorageLoader.decode(storage, 'bytes32') as Buffer).equals(toBuffer('0x0000000000000000000000000000000000000000000000000000000000000001')));
    const randomBytes32 = crypto.randomBytes(32);
    await contractCall(Buffer.concat([selectors.get('setBytes32')!, encode(['bytes32'], [bufferToHex(randomBytes32)])]));
    const storage1 = await storageLoader.loadStorageSlot(StorageLoader.indexToSlotIndex(new BN(3)));
    assert((StorageLoader.decode(storage1, 'bytes32') as Buffer).equals(randomBytes32));
  });

  it('should load address type storage', async () => {
    await contractCall(Buffer.concat([selectors.get('setAddress')!, encode(['address'], ['0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde'])]));
    const storage = await storageLoader.loadStorageSlot(StorageLoader.indexToSlotIndex(new BN(4)));
    expect(StorageLoader.decode(storage, 'address')).to.equals('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde');
    await contractCall(Buffer.concat([selectors.get('setAddress')!, encode(['address'], ['0xdcad3a6d3569df655070ded06cb7a1b2ccd1d3af'])]));
    const storage1 = await storageLoader.loadStorageSlot(StorageLoader.indexToSlotIndex(new BN(4)));
    expect(StorageLoader.decode(storage1, 'address')).to.equals('0xdcad3a6d3569df655070ded06cb7a1b2ccd1d3af');
  });

  it('should load struct type storage', async () => {
    await contractCall(Buffer.concat([selectors.get('setStruct')!, encode(['address', 'int256'], ['0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde', 123])]));
    const slot = StorageLoader.indexToSlotIndex(new BN(5));
    const propertySlot = storageLoader.getStructStorageIndex(slot, new BN(0));
    const storage = await storageLoader.loadStorageSlot(propertySlot);
    expect(StorageLoader.decode(storage, 'address')).to.equals('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde');
    const propertySlot1 = storageLoader.getStructStorageIndex(slot, new BN(1));
    const storage1 = await storageLoader.loadStorageSlot(propertySlot1);
    expect(StorageLoader.decode(storage1, 'int256').toString()).to.equals('123');

    await contractCall(Buffer.concat([selectors.get('setStruct')!, encode(['address', 'int256'], ['0xdcad3a6d3569df655070ded06cb7a1b2ccd1d3af', -123])]));
    const slot1 = StorageLoader.indexToSlotIndex(new BN(5));
    const propertySlot2 = storageLoader.getStructStorageIndex(slot1, new BN(0));
    const storage2 = await storageLoader.loadStorageSlot(propertySlot2);
    expect(StorageLoader.decode(storage2, 'address')).to.equals('0xdcad3a6d3569df655070ded06cb7a1b2ccd1d3af');
    const propertySlot3 = storageLoader.getStructStorageIndex(slot1, new BN(1));
    const storage3 = await storageLoader.loadStorageSlot(propertySlot3);
    expect(StorageLoader.decode(storage3, 'int256').toString()).to.equals('-123');
  });

  it('should load struct[] type storage', async () => {
    const slot = StorageLoader.indexToSlotIndex(new BN(7));
    const length = new BN(await storageLoader.loadStorageSlot(slot));
    assert(length.eqn(0));
    for (let i = 0; i < 10; i++) {
      await contractCall(Buffer.concat([selectors.get('setStructArray')!, encode(['address', 'int256'], ['0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde', '123'])]));
    }
    expect(new BN(await storageLoader.loadStorageSlot(slot)).toString()).to.equals('10');
    const propertyCount = 2;
    for (let i = 0; i < 10; i++) {
      const elementSlot = storageLoader.getArrayStorageIndex(slot, new BN(i), new BN(propertyCount));
      for (let j = 0; j < propertyCount; j++) {
        const propertySlot = storageLoader.getStructStorageIndex(elementSlot, new BN(j));
        const storage = await storageLoader.loadStorageSlot(propertySlot);
        if (j === 0) {
          expect(StorageLoader.decode(storage, 'address')).to.equals('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde');
        } else {
          expect(StorageLoader.decode(storage, 'int256').toString()).to.equals('123');
        }
      }
    }
  });

  it('should load mapping(address => struct) type storage', async () => {
    const slot = StorageLoader.indexToSlotIndex(new BN(8));
    await contractCall(Buffer.concat([selectors.get('setMapping1')!, encode(['address', 'address', 'int256'], ['0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde', '0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde', 123])]));
    const elementSlot = storageLoader.getMappingStorageIndex(slot, toBuffer('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde'));
    const propertySlot = storageLoader.getStructStorageIndex(elementSlot, new BN(0));
    const propertySlot1 = storageLoader.getStructStorageIndex(elementSlot, new BN(1));
    const storage = await storageLoader.loadStorageSlot(propertySlot);
    expect(StorageLoader.decode(storage, 'address')).to.equals('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde');
    const storage1 = await storageLoader.loadStorageSlot(propertySlot1);

    // reset mapping value
    expect(StorageLoader.decode(storage1, 'int256').toString()).to.equals('123');
    await contractCall(Buffer.concat([selectors.get('setMapping1')!, encode(['address', 'address', 'int256'], ['0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde', '0xdcad3a6d3569df655070ded06cb7a1b2ccd1d3af', -123])]));
    const elementSlot1 = storageLoader.getMappingStorageIndex(slot, toBuffer('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde'));
    const propertySlot2 = storageLoader.getStructStorageIndex(elementSlot1, new BN(0));
    const propertySlot3 = storageLoader.getStructStorageIndex(elementSlot1, new BN(1));
    const storage2 = await storageLoader.loadStorageSlot(propertySlot2);
    expect(StorageLoader.decode(storage2, 'address')).to.equals('0xdcad3a6d3569df655070ded06cb7a1b2ccd1d3af');
    const storage3 = await storageLoader.loadStorageSlot(propertySlot3);
    expect(StorageLoader.decode(storage3, 'int256').toString()).to.equals('-123');
  });

  it('should load mapping(bytes32 => bool) type storage', async () => {
    const slot = StorageLoader.indexToSlotIndex(new BN(9));
    const key1 = toBuffer('0x0000000000000000000000000000000000000000000000000000000000000001');
    await contractCall(Buffer.concat([selectors.get('setMapping2')!, encode(['bytes32', 'bool'], [key1, true])]));
    const elementSlot = storageLoader.getMappingStorageIndex(slot, key1);
    const storage = await storageLoader.loadStorageSlot(elementSlot);
    expect(StorageLoader.decode(storage, 'bool')).to.equals(true);

    await contractCall(Buffer.concat([selectors.get('setMapping2')!, encode(['bytes32', 'bool'], [key1, false])]));
    const elementSlot1 = storageLoader.getMappingStorageIndex(slot, key1);
    const storage1 = await storageLoader.loadStorageSlot(elementSlot1);
    expect(StorageLoader.decode(storage1, 'bool')).to.equals(false);
  });

  it('should load string type storage', async () => {
    const slot = StorageLoader.indexToSlotIndex(new BN(10));
    let str = 'hello world';
    await contractCall(Buffer.concat([selectors.get('setString')!, encode(['string'], [str])]));
    let storage = await storageLoader.loadBytesOrString(slot);
    expect(storage.toString()).to.equals(str);

    str = 'world hello';
    await contractCall(Buffer.concat([selectors.get('setString')!, encode(['string'], [str])]));
    storage = await storageLoader.loadBytesOrString(slot);
    expect(storage.toString()).to.equals(str);
  });

  it('should load bytes type storage', async () => {
    // bytes length <= 31
    const slot = StorageLoader.indexToSlotIndex(new BN(11));
    let data = Buffer.from([0, 1, 1, 1, 1, 1, 2, 1, 1]);
    await contractCall(Buffer.concat([selectors.get('setBytes')!, encode(['bytes'], [data])]));
    let storage = await storageLoader.loadBytesOrString(slot);
    assert(storage.equals(data));

    // bytes length > 31
    data = Buffer.from([0, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    await contractCall(Buffer.concat([selectors.get('setBytes')!, encode(['bytes'], [data])]));
    storage = await storageLoader.loadBytesOrString(slot);
    assert(storage.equals(data));
  });
});
