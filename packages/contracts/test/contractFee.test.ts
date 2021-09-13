import type { Artifacts } from 'hardhat/types';
import type Web3 from 'web3';
import { assert, expect } from 'chai';
import { BN, generateAddress, generateAddress2, Address, keccak256, MAX_INTEGER, bufferToHex } from 'ethereumjs-util';
import { toBN } from './utils';

declare var artifacts: Artifacts;
declare var web3: Web3;

const Config = artifacts.require('Config_test');
const Factory = artifacts.require('Factory');
const Product = artifacts.require('Product');
const ContractFee = artifacts.require('ContractFee');

describe('ContractFee', () => {
  let config: any;
  let factory: any;
  let contractFee: any;
  let deployer: any;
  let productBytecode: any;
  let product1: any;
  let product2: any;
  let salt: Buffer;

  function create(nonce: BN) {
    return new Address(generateAddress(Address.fromString(factory.options.address).buf, nonce.toBuffer())).toString();
  }

  function create2(salt: Buffer) {
    return new Address(generateAddress2(Address.fromString(factory.options.address).buf, salt, productBytecode)).toString();
  }

  function createProductContract(address: string) {
    return new web3.eth.Contract(Product.abi, address, { from: deployer });
  }

  before(async () => {
    const accounts = await web3.eth.getAccounts();
    deployer = accounts[0];
  });

  it('should deploy succeed', async () => {
    config = new web3.eth.Contract(Config.abi, (await Config.new()).address, { from: deployer });
    await config.methods.setRouter(deployer).send();
    factory = new web3.eth.Contract(Factory.abi, (await Factory.new(config.options.address)).address, { from: deployer });

    contractFee = new web3.eth.Contract(ContractFee.abi, (await ContractFee.new(config.options.address)).address, { from: deployer });
    await config.methods.setContractFee(contractFee.options.address).send();
    expect(await config.methods.contractFee().call(), 'contract fee address should be equal').be.equal(contractFee.options.address);

    productBytecode = Buffer.from((await factory.methods.productBytecode().call()).substr(2), 'hex');
    // we directly use keccak256(bytecode) instead of salt
    salt = keccak256(productBytecode);
  });

  it('should generate address correctly', async () => {
    const nonces: BN[] = ['0', '1', '2', '3', '5', '127', '128', '70000', '2323', '2147483643', '2147483648'].map((str) => new BN(str)).concat([MAX_INTEGER]);
    for (const nonce of nonces) {
      expect(create(nonce).toLowerCase(), 'should generate correctly').be.equal((await contractFee.methods.generateAddress(factory.options.address, nonce.toString()).call()).toLowerCase());
    }
  });

  it('should generate address correctly(create2)', async () => {
    expect(create2(salt).toLowerCase(), 'should generate correctly(create2)').be.equal((await contractFee.methods.generateAddress2(factory.options.address, salt, salt).call()).toLowerCase());
  });

  it('should produce succeed', async () => {
    const {
      events: {
        NewProduct: {
          returnValues: { product }
        }
      }
    } = await factory.methods.produce().send();
    // a new contract address' nonce will be 1 instead of 0
    expect((product as string).toLocaleLowerCase(), 'should produce succeed').be.equal(create(new BN(1)));
    product1 = product;
  });

  it('should produce2 succeed', async () => {
    const {
      events: {
        NewProduct: {
          returnValues: { product }
        }
      }
    } = await factory.methods.produce2(bufferToHex(salt)).send();
    expect((product as string).toLocaleLowerCase(), 'should produce2 succeed').be.equal(create2(salt));
    product2 = product;
  });

  it('should register succeed(produce)', async () => {
    await contractFee.methods.register(deployer, [true, true], [2, 1], []).send();
    expect(await contractFee.methods.creatorOf(factory.options.address).call(), 'creator of factory should be deployer').be.equal(deployer);
    expect(await contractFee.methods.creatorOf(product1).call(), 'creator of product1 should be factory').be.equal(factory.options.address);
  });

  it('should register succeed(produce2)', async () => {
    await contractFee.methods
      .register(
        deployer,
        [true, false],
        [2],
        [
          {
            salt,
            deployCodeHash: salt,
            codeHash: keccak256(productBytecode.slice(32))
          }
        ]
      )
      .send();
    expect(await contractFee.methods.creatorOf(factory.options.address).call(), 'creator of factory should be deployer').be.equal(deployer);
    expect(await contractFee.methods.creatorOf(product2).call(), 'creator of product2 should be factory').be.equal(factory.options.address);
  });
});
