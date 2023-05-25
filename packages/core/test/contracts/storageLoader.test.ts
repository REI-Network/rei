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

    constructor() {
        s = S(0xFF96A3BfF24DA3d686FeA7BD4bEB5ccFD7868DdE, 321);
        t9 = "0x34bb5a21c262d943fe7e427ab98736982e2eacab59ac01f17855448712144faf852795c4745879a0c1cd8d393f760638f4209e4c7b684f4300edb2034bc08a91";
        t10 = "0x487a22cf8a60cbf9bd05f4765bddf4c74228c4b7f6340523b9add3e9c46e1de3c8ae29987238b9bd2fc729637331441a3c99721c071519851b32f152985e1bcf1eec0d15c4fc96fa4173";
        t11 = "123";
        for (uint256 i = 0; i < 10; i++) {
            t3.push(i);
            t4.push(bytes32(i));
            t5[i] = i;
            t6[bytes32(i)] = 0xFF96A3BfF24DA3d686FeA7BD4bEB5ccFD7868DdE;
            t7.push(S(0xFF96A3BfF24DA3d686FeA7BD4bEB5ccFD7868DdE, 321));
            t8[i] = S(0xFF96A3BfF24DA3d686FeA7BD4bEB5ccFD7868DdE, 321);
        }
    }

}
*/

const exampleContractByteCode = hexStringToBuffer(
  '60806040526001600055600160001b60015534801561001d57600080fd5b50604051806040016040528073ff96a3bff24da3d686fea7bd4beb5ccfd7868dde73ffffffffffffffffffffffffffffffffffffffff168152602001610141815250600660008201518160000160006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550602082015181600101559050506040518060c001604052806082815260200161095560829139600a90816100dc91906105fc565b506040518060c00160405280609681526020016108bf60969139600b908161010491906105fc565b506040518060400160405280600381526020017f3132330000000000000000000000000000000000000000000000000000000000815250600c90816101499190610729565b5060005b600a8110156103a657600281908060018154018082558091505060019003906000526020600020016000909190919091505560038160001b908060018154018082558091505060019003906000526020600020016000909190919091505580600460008381526020019081526020016000208190555073ff96a3bff24da3d686fea7bd4beb5ccfd7868dde600560008360001b815260200190815260200160002060006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055506008604051806040016040528073ff96a3bff24da3d686fea7bd4beb5ccfd7868dde73ffffffffffffffffffffffffffffffffffffffff168152602001610141815250908060018154018082558091505060019003906000526020600020906002020160009091909190915060008201518160000160006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550602082015181600101555050604051806040016040528073ff96a3bff24da3d686fea7bd4beb5ccfd7868dde73ffffffffffffffffffffffffffffffffffffffff1681526020016101418152506009600083815260200190815260200160002060008201518160000160006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555060208201518160010155905050808061039e9061082a565b91505061014d565b50610872565b600081519050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b7f4e487b7100000000000000000000000000000000000000000000000000000000600052602260045260246000fd5b6000600282049050600182168061042d57607f821691505b6020821081036104405761043f6103e6565b5b50919050565b60008190508160005260206000209050919050565b60006020601f8301049050919050565b600082821b905092915050565b6000600883026104a87fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff8261046b565b6104b2868361046b565b95508019841693508086168417925050509392505050565b6000819050919050565b6000819050919050565b60006104f96104f46104ef846104ca565b6104d4565b6104ca565b9050919050565b6000819050919050565b610513836104de565b61052761051f82610500565b848454610478565b825550505050565b600090565b61053c61052f565b61054781848461050a565b505050565b5b8181101561056b57610560600082610534565b60018101905061054d565b5050565b601f8211156105b05761058181610446565b61058a8461045b565b81016020851015610599578190505b6105ad6105a58561045b565b83018261054c565b50505b505050565b600082821c905092915050565b60006105d3600019846008026105b5565b1980831691505092915050565b60006105ec83836105c2565b9150826002028217905092915050565b610605826103ac565b67ffffffffffffffff81111561061e5761061d6103b7565b5b6106288254610415565b61063382828561056f565b600060209050601f8311600181146106665760008415610654578287015190505b61065e85826105e0565b8655506106c6565b601f19841661067486610446565b60005b8281101561069c57848901518255600182019150602085019450602081019050610677565b868310156106b957848901516106b5601f8916826105c2565b8355505b6001600288020188555050505b505050505050565b60008190508160005260206000209050919050565b601f821115610724576106f5816106ce565b6106fe8461045b565b8101602085101561070d578190505b6107216107198561045b565b83018261054c565b50505b505050565b610732826103ac565b67ffffffffffffffff81111561074b5761074a6103b7565b5b6107558254610415565b6107608282856106e3565b600060209050601f8311600181146107935760008415610781578287015190505b61078b85826105e0565b8655506107f3565b601f1984166107a1866106ce565b60005b828110156107c9578489015182556001820191506020850194506020810190506107a4565b868310156107e657848901516107e2601f8916826105c2565b8355505b6001600288020188555050505b505050505050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052601160045260246000fd5b6000610835826104ca565b91507fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff8203610867576108666107fb565b5b600182019050919050565b603f806108806000396000f3fe6080604052600080fdfea264697066735822122028bdd837ef7f916163f1a411dda61201157ea64a6b5942bef41a94cf9f04534d64736f6c6343000812003330783438376132326366386136306362663962643035663437363562646466346337343232386334623766363334303532336239616464336539633436653164653363386165323939383732333862396264326663373239363337333331343431613363393937323163303731353139383531623332663135323938356531626366316565633064313563346663393666613431373330783334626235613231633236326439343366653765343237616239383733363938326532656163616235396163303166313738353534343837313231343466616638353237393563343734353837396130633163643864333933663736303633386634323039653463376236383466343330306564623230333462633038613931'
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
    expect(bufferToInt(storage)).to.equal(1);
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
      expect(bufferToInt(await storageLoader.loadStorageSlot(elementSlot))).to.equals(i);
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
      expect(bufferToInt(await storageLoader.loadStorageSlot(elementSlot))).to.equals(i);
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
        expect(bufferToInt(await storageLoader.loadStorageSlot(propertySlot))).to.equals(321);
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
          expect(bufferToInt(await storageLoader.loadStorageSlot(propertySlot))).to.equals(321);
        }
      }
    }
  });

  it('should load mapping(uint256 => struct) type storage', async () => {
    const slot = StorageLoader.indexToSlotIndex(new BN(9));
    for (let i = 0; i < 10; i++) {
      const elementSlot = storageLoader.getMappingStorageIndex(slot, setLengthLeft(new BN(i).toBuffer(), 32));
      for (let j = 0; j < 2; j++) {
        const propertySlot = storageLoader.getStructStorageIndex(elementSlot, new BN(j));
        if (j === 0) {
          expect(bufferToHex(await storageLoader.loadStorageSlot(propertySlot))).to.equals('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde');
        }
        if (j === 1) {
          expect(bufferToInt(await storageLoader.loadStorageSlot(propertySlot))).to.equals(321);
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
});
