import path from 'path';
import { expect, assert } from 'chai';
import { Address, BN, setLengthLeft, toBuffer, bufferToHex } from 'ethereumjs-util';
import { AbiCoder } from '@ethersproject/abi';
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
import { encode } from '../../src/consensus/reimint/contracts/utils';

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
    bytes public t15;

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

    function setBytes(bytes calldata _bytes) public {
        t15 = _bytes;
    }
}

*/

const exampleContractByteCode = hexStringToBuffer(
  '60806040526001600055600160001b6001553480156200001e57600080fd5b50604051806040016040528073ff96a3bff24da3d686fea7bd4beb5ccfd7868dde73ffffffffffffffffffffffffffffffffffffffff168152602001610141815250600660008201518160000160006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550602082015181600101559050506040518060c0016040528060828152602001620011b160829139600a9081620000e091906200087f565b506040518060c00160405280609681526020016200111b60969139600b90816200010b91906200087f565b506040518060400160405280600381526020017f3132330000000000000000000000000000000000000000000000000000000000815250600c9081620001529190620009cb565b5073ff96a3bff24da3d686fea7bd4beb5ccfd7868dde600d60006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555060005b600a8110156200040857600281908060018154018082558091505060019003906000526020600020016000909190919091505560038160001b908060018154018082558091505060019003906000526020600020016000909190919091505580600460008381526020019081526020016000208190555073ff96a3bff24da3d686fea7bd4beb5ccfd7868dde600560008360001b815260200190815260200160002060006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055506008604051806040016040528073ff96a3bff24da3d686fea7bd4beb5ccfd7868dde73ffffffffffffffffffffffffffffffffffffffff168152602001610141815250908060018154018082558091505060019003906000526020600020906002020160009091909190915060008201518160000160006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550602082015181600101555050604051806040016040528073ff96a3bff24da3d686fea7bd4beb5ccfd7868dde73ffffffffffffffffffffffffffffffffffffffff1681526020016101418152506009600083815260200190815260200160002060008201518160000160006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550602082015181600101559050508080620003ff9062000ae1565b915050620001ab565b50604051806040016040528073ff96a3bff24da3d686fea7bd4beb5ccfd7868dde73ffffffffffffffffffffffffffffffffffffffff168152602001610141815250600e600073ff96a3bff24da3d686fea7bd4beb5ccfd7868dde73ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060008201518160000160006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555060208201518160010155905050604051806040016040528073edfe730a3589de207c54df997514a7f5a368360373ffffffffffffffffffffffffffffffffffffffff168152602001607b815250600e600073edfe730a3589de207c54df997514a7f5a368360373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060008201518160000160006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550602082015181600101559050507fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff85600f8190555062000b2e565b600081519050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b7f4e487b7100000000000000000000000000000000000000000000000000000000600052602260045260246000fd5b600060028204905060018216806200068757607f821691505b6020821081036200069d576200069c6200063f565b5b50919050565b60008190508160005260206000209050919050565b60006020601f8301049050919050565b600082821b905092915050565b600060088302620007077fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff82620006c8565b620007138683620006c8565b95508019841693508086168417925050509392505050565b6000819050919050565b6000819050919050565b6000620007606200075a62000754846200072b565b62000735565b6200072b565b9050919050565b6000819050919050565b6200077c836200073f565b620007946200078b8262000767565b848454620006d5565b825550505050565b600090565b620007ab6200079c565b620007b881848462000771565b505050565b5b81811015620007e057620007d4600082620007a1565b600181019050620007be565b5050565b601f8211156200082f57620007f981620006a3565b6200080484620006b8565b8101602085101562000814578190505b6200082c6200082385620006b8565b830182620007bd565b50505b505050565b600082821c905092915050565b6000620008546000198460080262000834565b1980831691505092915050565b60006200086f838362000841565b9150826002028217905092915050565b6200088a8262000605565b67ffffffffffffffff811115620008a657620008a562000610565b5b620008b282546200066e565b620008bf828285620007e4565b600060209050601f831160018114620008f75760008415620008e2578287015190505b620008ee858262000861565b8655506200095e565b601f1984166200090786620006a3565b60005b8281101562000931578489015182556001820191506020850194506020810190506200090a565b868310156200095157848901516200094d601f89168262000841565b8355505b6001600288020188555050505b505050505050565b60008190508160005260206000209050919050565b601f821115620009c657620009908162000966565b6200099b84620006b8565b81016020851015620009ab578190505b620009c3620009ba85620006b8565b830182620007bd565b50505b505050565b620009d68262000605565b67ffffffffffffffff811115620009f257620009f162000610565b5b620009fe82546200066e565b62000a0b8282856200097b565b600060209050601f83116001811462000a43576000841562000a2e578287015190505b62000a3a858262000861565b86555062000aaa565b601f19841662000a538662000966565b60005b8281101562000a7d5784890151825560018201915060208501945060208101905062000a56565b8683101562000a9d578489015162000a99601f89168262000841565b8355505b6001600288020188555050505b505050505050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052601160045260246000fd5b600062000aee826200072b565b91507fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff820362000b235762000b2262000ab2565b5b600182019050919050565b6105dd8062000b3e6000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c8063da359dc81461003b578063f14bb67c14610057575b600080fd5b61005560048036038101906100509190610188565b610075565b005b61005f61008b565b60405161006c9190610265565b60405180910390f35b8181601091826100869291906104d7565b505050565b60108054610098906102f0565b80601f01602080910402602001604051908101604052809291908181526020018280546100c4906102f0565b80156101115780601f106100e657610100808354040283529160200191610111565b820191906000526020600020905b8154815290600101906020018083116100f457829003601f168201915b505050505081565b600080fd5b600080fd5b600080fd5b600080fd5b600080fd5b60008083601f84011261014857610147610123565b5b8235905067ffffffffffffffff81111561016557610164610128565b5b6020830191508360018202830111156101815761018061012d565b5b9250929050565b6000806020838503121561019f5761019e610119565b5b600083013567ffffffffffffffff8111156101bd576101bc61011e565b5b6101c985828601610132565b92509250509250929050565b600081519050919050565b600082825260208201905092915050565b60005b8381101561020f5780820151818401526020810190506101f4565b60008484015250505050565b6000601f19601f8301169050919050565b6000610237826101d5565b61024181856101e0565b93506102518185602086016101f1565b61025a8161021b565b840191505092915050565b6000602082019050818103600083015261027f818461022c565b905092915050565b600082905092915050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b7f4e487b7100000000000000000000000000000000000000000000000000000000600052602260045260246000fd5b6000600282049050600182168061030857607f821691505b60208210810361031b5761031a6102c1565b5b50919050565b60008190508160005260206000209050919050565b60006020601f8301049050919050565b600082821b905092915050565b6000600883026103837fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff82610346565b61038d8683610346565b95508019841693508086168417925050509392505050565b6000819050919050565b6000819050919050565b60006103d46103cf6103ca846103a5565b6103af565b6103a5565b9050919050565b6000819050919050565b6103ee836103b9565b6104026103fa826103db565b848454610353565b825550505050565b600090565b61041761040a565b6104228184846103e5565b505050565b5b818110156104465761043b60008261040f565b600181019050610428565b5050565b601f82111561048b5761045c81610321565b61046584610336565b81016020851015610474578190505b61048861048085610336565b830182610427565b50505b505050565b600082821c905092915050565b60006104ae60001984600802610490565b1980831691505092915050565b60006104c7838361049d565b9150826002028217905092915050565b6104e18383610287565b67ffffffffffffffff8111156104fa576104f9610292565b5b61050482546102f0565b61050f82828561044a565b6000601f83116001811461053e576000841561052c578287013590505b61053685826104bb565b86555061059e565b601f19841661054c86610321565b60005b828110156105745784890135825560018201915060208501945060208101905061054f565b86831015610591578489013561058d601f89168261049d565b8355505b6001600288020188555050505b5050505050505056fea26469706673582212201389898c6ec1c122445126d1b19c7229fdc01440bceaaf06b89952d749e9838b64736f6c6343000812003330783438376132326366386136306362663962643035663437363562646466346337343232386334623766363334303532336239616464336539633436653164653363386165323939383732333862396264326663373239363337333331343431613363393937323163303731353139383531623332663135323938356531626366316565633064313563346663393666613431373330783334626235613231633236326439343366653765343237616239383733363938326532656163616235396163303166313738353534343837313231343466616638353237393563343734353837396130633163643864333933663736303633386634323039653463376236383466343330306564623230333462633038613931'
);

const exampleContractAddress = Address.fromString('0x0000000000000000000000000000000000001010');

const setBytesSelector = toBuffer('0xda359dc8');

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

  it('should load uint256 type storage', async () => {
    const storage = await storageLoader.loadStorageSlot(StorageLoader.indexToSlotIndex(new BN(0)));
    expect(StorageLoader.decode(storage, 'uint256').toString()).to.equal('1');
  });

  it('should load bytes32 type storage', async () => {
    const storage = await storageLoader.loadStorageSlot(StorageLoader.indexToSlotIndex(new BN(1)));
    assert(storage.equals(toBuffer('0x0000000000000000000000000000000000000000000000000000000000000001')));
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
      expect(StorageLoader.decode(await storageLoader.loadStorageSlot(elementSlot), 'address')).to.equals('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde');
    }
  });

  it('should load struct type storage', async () => {
    const slot = StorageLoader.indexToSlotIndex(new BN(6));
    for (let i = 0; i < 2; i++) {
      const propertySlot = storageLoader.getStructStorageIndex(slot, new BN(i));
      if (i === 0) {
        expect(StorageLoader.decode(await storageLoader.loadStorageSlot(propertySlot), 'address')).to.equals('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde');
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
      const elementSlot = storageLoader.getArrayStorageIndex(slot, new BN(i), new BN(propertyCount));
      for (let j = 0; j < 2; j++) {
        const propertySlot = storageLoader.getStructStorageIndex(elementSlot, new BN(j));
        if (j === 0) {
          expect(StorageLoader.decode(await storageLoader.loadStorageSlot(propertySlot), 'address')).to.equals('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde');
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
          expect(StorageLoader.decode(await storageLoader.loadStorageSlot(propertySlot), 'address')).to.equals('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde');
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
    expect(StorageLoader.decode(storage, 'address')).to.equals('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde');
  });

  it('should load mapping(address => struct) type storage ', async () => {
    const slot = StorageLoader.indexToSlotIndex(new BN(14));
    const elementSlot1 = storageLoader.getMappingStorageIndex(slot, toBuffer('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde'));
    const propertySlot1 = storageLoader.getStructStorageIndex(elementSlot1, new BN(0));
    const propertySlot2 = storageLoader.getStructStorageIndex(elementSlot1, new BN(1));
    expect(StorageLoader.decode(await storageLoader.loadStorageSlot(propertySlot1), 'address')).to.equals('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde');
    expect(new BN(await storageLoader.loadStorageSlot(propertySlot2)).toString()).to.equals('321');

    const elementSlot2 = storageLoader.getMappingStorageIndex(slot, toBuffer('0xedfe730a3589de207c54df997514a7f5a3683603'));
    const propertySlot3 = storageLoader.getStructStorageIndex(elementSlot2, new BN(0));
    const propertySlot4 = storageLoader.getStructStorageIndex(elementSlot2, new BN(1));
    expect(StorageLoader.decode(await storageLoader.loadStorageSlot(propertySlot3), 'address')).to.equals('0xedfe730a3589de207c54df997514a7f5a3683603');
    expect(new BN(await storageLoader.loadStorageSlot(propertySlot4)).toString()).to.equals('123');
  });

  it('should load int256 type storage', async () => {
    const slot = StorageLoader.indexToSlotIndex(new BN(15));
    const storage = await storageLoader.loadStorageSlot(slot);
    expect(new BN(coder.decode(['int256'], storage)[0].toString()).toString()).to.equals('-123');
  });

  it('should load bytes type storage', async () => {
    let data = Buffer.from([0, 1, 1, 1, 1, 1, 2, 1, 1]);
    await evm.executeMessage(
      new Message({
        caller: Address.fromString(common.param('vm', 'scaddr')),
        to: exampleContractAddress,
        gasLimit: new BN('9223372036854775807'),
        value: 0,
        isStatic: false,
        data: Buffer.concat([setBytesSelector, encode(['bytes'], [data])])
      })
    );

    const slot = StorageLoader.indexToSlotIndex(new BN(16));
    let storage = await storageLoader.loadBytesOrString(slot);
    assert(storage.equals(data));
    data = Buffer.from([0, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    await evm.executeMessage(
      new Message({
        caller: Address.fromString(common.param('vm', 'scaddr')),
        to: exampleContractAddress,
        gasLimit: new BN('9223372036854775807'),
        value: 0,
        isStatic: false,
        data: Buffer.concat([setBytesSelector, encode(['bytes'], [data])])
      })
    );

    storage = await storageLoader.loadBytesOrString(slot);
    assert(storage.equals(data));
  });
});
