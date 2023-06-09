import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract, ContractFactory, Signer } from 'ethers';
import { getRandomBytes } from './utils';

const genesisAddress = ['0xFF96A3BfF24DA3d686FeA7BD4bEB5ccFD7868DdE', '0x809FaE291f79c9953577Ee9007342cff84014b1c', '0x57B80007d142297Bc383A741E4c1dd18e4C75754', '0x8d187Ee877EeFF8698De6808568FD9f1415c7f91', '0x5eB85b475068F7cAA22B2758D58C4B100A418684'];

describe('ValidatorBLS', () => {
  let validatorBLS: Contract;
  let deployer: Signer;
  let user1: Signer;
  let deployerAddr: string;
  let user1Addr: string;
  let validatorBLSFactory: ContractFactory;
  const genesisBLSPublickeys = genesisAddress.map(() => getRandomBytes(48));

  before(async () => {
    [deployer, user1] = await ethers.getSigners();
    deployerAddr = await deployer.getAddress();
    user1Addr = await user1.getAddress();
    validatorBLSFactory = await ethers.getContractFactory('ValidatorBLS');
  });

  beforeEach(async () => {
    validatorBLS = await validatorBLSFactory.connect(deployer).deploy(genesisAddress, genesisBLSPublickeys);
  });

  it('should get genesis validators BLS public key', async () => {
    for (let i = 0; i < genesisAddress.length; i++) {
      expect(await validatorBLS.getBLSPublicKey(genesisAddress[i])).to.equal(genesisBLSPublickeys[i]);
    }
  });

  it('should set validator BLS public key', async () => {
    const validatorBLSPublicKey = getRandomBytes(48);
    await validatorBLS.connect(user1).setBLSPublicKey(validatorBLSPublicKey);
    expect(await validatorBLS.getBLSPublicKey(await user1.getAddress())).to.equal(validatorBLSPublicKey);
    const validatorBLSPublicKey1 = getRandomBytes(48);
    await validatorBLS.connect(user1).setBLSPublicKey(validatorBLSPublicKey1);
    expect(await validatorBLS.getBLSPublicKey(await user1.getAddress())).to.equal(validatorBLSPublicKey1);
  });

  it('should get validators length', async () => {
    expect(await validatorBLS.validatorsLength()).to.equal(5);
    await validatorBLS.connect(user1).setBLSPublicKey(getRandomBytes(48));
    expect(await validatorBLS.validatorsLength()).to.equal(6);
    await validatorBLS.connect(user1).setBLSPublicKey(getRandomBytes(48));
    expect(await validatorBLS.validatorsLength()).to.equal(6);
  });

  it('should get validators', async () => {
    await validatorBLS.connect(user1).setBLSPublicKey(getRandomBytes(48));
    expect(await validatorBLS.validators(5)).to.equal(await user1.getAddress());
  });

  it("should set correttly validator's BLS public key", async () => {
    try {
      await validatorBLS.connect(user1).setBLSPublicKey(getRandomBytes(10));
    } catch (e) {
      expect((e as any).message).to.equal('Transaction reverted without a reason string');
    }
  });

  it('should get the validator is registered BLS public key', async () => {
    expect(await validatorBLS.isRegistered(await user1.getAddress())).to.equal(false);
    await validatorBLS.connect(user1).setBLSPublicKey(getRandomBytes(48));
    expect(await validatorBLS.isRegistered(await user1.getAddress())).to.equal(true);
  });

  it('should the BLS public key can only be set once', async () => {
    const BLSPublicKey = getRandomBytes(48);
    expect(await validatorBLS.isBLSPublicKeyExist(BLSPublicKey)).to.equal(false);
    await validatorBLS.connect(user1).setBLSPublicKey(BLSPublicKey);
    expect(await validatorBLS.isBLSPublicKeyExist(BLSPublicKey)).to.equal(true);
    try {
      await validatorBLS.connect(deployer).setBLSPublicKey(BLSPublicKey);
    } catch (e) {
      expect((e as any).message).to.equal('Transaction reverted without a reason string');
    }
  });
});

describe('ValidatorBLSFallback', () => {
  it('should set validator BLS public key', async () => {
    const fallBackFactory: ContractFactory = await ethers.getContractFactory('ValidatorBLSFallback');
    const fallback: Contract = await fallBackFactory.deploy();
    const validatorBLSFactory: ContractFactory = await ethers.getContractFactory('ValidatorBLS');
    const validatorBLS: Contract = await validatorBLSFactory.attach(fallback.address);
    try {
      await validatorBLS.setBLSPublicKey(getRandomBytes(48));
    } catch (e) {
      expect((e as any).message).to.equal('Transaction reverted without a reason string');
    }
  });
});
