import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract, ContractFactory, Signer } from 'ethers';
import { getRandomBytes } from './utils';

describe('ValidatorBls', () => {
  let validatorBls: Contract;
  let deployer: Signer;
  let user1: Signer;
  let deployerAddr: string;
  let user1Addr: string;
  let validatorBlsFactory: ContractFactory;
  let configFactory: ContractFactory;

  before(async () => {
    [deployer, user1] = await ethers.getSigners();
    deployerAddr = await deployer.getAddress();
    user1Addr = await user1.getAddress();
    validatorBlsFactory = await ethers.getContractFactory('ValidatorBls');
    configFactory = await ethers.getContractFactory('Config_devnet');
  });

  beforeEach(async () => {
    validatorBls = await validatorBlsFactory.connect(deployer).deploy();
  });

  it('should set validator bls public key', async () => {
    const validatorBlsPublicKey = getRandomBytes(48);
    await validatorBls.connect(user1).setBlsPublicKey(validatorBlsPublicKey);
    expect(await validatorBls.getBlsPublicKey(await user1.getAddress())).to.equal(validatorBlsPublicKey);
    const validatorBlsPublicKey1 = getRandomBytes(48);
    await validatorBls.connect(user1).setBlsPublicKey(validatorBlsPublicKey1);
    expect(await validatorBls.getBlsPublicKey(await user1.getAddress())).to.equal(validatorBlsPublicKey1);
  });

  it('should get validators length', async () => {
    expect(await validatorBls.validatorsLength()).to.equal(0);
    await validatorBls.connect(user1).setBlsPublicKey(getRandomBytes(48));
    expect(await validatorBls.validatorsLength()).to.equal(1);
    await validatorBls.connect(user1).setBlsPublicKey(getRandomBytes(48));
    expect(await validatorBls.validatorsLength()).to.equal(1);
  });

  it('should get validators', async () => {
    await validatorBls.connect(user1).setBlsPublicKey(getRandomBytes(48));
    expect(await validatorBls.validators(0)).to.equal(await user1.getAddress());
  });

  it("should set correttly validator's bls public key", async () => {
    try {
      await validatorBls.connect(user1).setBlsPublicKey(getRandomBytes(10));
    } catch (e) {
      expect((e as any).message).to.equal('Transaction reverted without a reason string');
    }
  });

  it('should get the validator is registered bls public key', async () => {
    expect(await validatorBls.isRegistered(await user1.getAddress())).to.equal(false);
    await validatorBls.connect(user1).setBlsPublicKey(getRandomBytes(48));
    expect(await validatorBls.isRegistered(await user1.getAddress())).to.equal(true);
  });

  it('should the bls public key can only be set once', async () => {
    const blsPublicKey = getRandomBytes(48);
    expect(await validatorBls.blsPublicKeyExist(blsPublicKey)).to.equal(false);
    await validatorBls.connect(user1).setBlsPublicKey(blsPublicKey);
    expect(await validatorBls.blsPublicKeyExist(blsPublicKey)).to.equal(true);
    try {
      await validatorBls.connect(deployer).setBlsPublicKey(blsPublicKey);
    } catch (e) {
      expect((e as any).message).to.equal('Transaction reverted without a reason string');
    }
  });
});

describe('ValidatorBlsFallback', () => {
  it('should set validator bls public key', async () => {
    const fallBackFactory: ContractFactory = await ethers.getContractFactory('ValidatorBlsFallback');
    const fallback: Contract = await fallBackFactory.deploy();
    const validatorBlsFactory: ContractFactory = await ethers.getContractFactory('ValidatorBls');
    const validatorBls: Contract = await validatorBlsFactory.attach(fallback.address);
    try {
      await validatorBls.setBlsPublicKey(getRandomBytes(48));
    } catch (e) {
      expect((e as any).message).to.equal('Transaction reverted without a reason string');
    }
  });
});
