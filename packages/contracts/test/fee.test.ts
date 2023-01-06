import { assert, expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract, ContractFactory, Signer } from 'ethers';
import { upTimestamp } from './utils';

describe('Fee', () => {
  let config: Contract;
  let fee: Contract;
  let deployer: Signer;
  let user1: Signer;
  let deployerAddr: string;
  let user1Addr: string;
  let withdrawDelay: number;
  let configFactory: ContractFactory;
  let feeFactory: ContractFactory;

  before(async () => {
    [deployer, user1] = await ethers.getSigners();
    deployerAddr = await deployer.getAddress();
    user1Addr = await user1.getAddress();
    configFactory = await ethers.getContractFactory('Config_devnet');
    feeFactory = await ethers.getContractFactory('Fee');
  });

  it('should deploy succeed', async () => {
    config = await configFactory.connect(deployer).deploy();
    await config.setSystemCaller(deployerAddr);

    fee = await feeFactory.connect(deployer).deploy(config.address);
    await config.setFee(fee.address);
    expect(await config.fee(), 'fee address should be equal').be.equal(fee.address);

    withdrawDelay = 3;
    await config.connect(deployer).setWithdrawDelay(withdrawDelay);
    expect(await config.withdrawDelay(), 'withdraw delay should be equal').be.equal(withdrawDelay.toString());
  });

  it('should deposit succeed', async () => {
    await fee.deposit(deployerAddr, { value: '100' });
    expect((await fee.userDeposit(deployerAddr, deployerAddr)).amount, 'amount should be equal').be.equal('100');
  });

  it('should withdraw failed', async () => {
    try {
      await fee.withdraw(deployerAddr, 100);
      assert.fail("shouldn't succeed");
    } catch (err) {}
  });

  it('should withdraw succeed', async () => {
    await upTimestamp(deployerAddr, withdrawDelay);
    await fee.withdraw(deployerAddr, 100);
    expect((await fee.userDeposit(deployerAddr, deployerAddr)).amount, 'amount should be equal').be.equal('0');
  });

  it('should deposit succeed(depositTo)', async () => {
    await fee.deposit(user1Addr, { value: 100 });
    expect((await fee.userDeposit(user1Addr, deployerAddr)).amount, 'amount should be equal').be.equal('100');
  });

  it('should withdraw failed(withdrawFrom)', async () => {
    try {
      await fee.methods.withdraw(user1, 100).send();
      assert.fail("shouldn't succeed");
    } catch (err) {}
  });

  it('should withdraw succeed(withdrawFrom)', async () => {
    await upTimestamp(deployerAddr, withdrawDelay);
    await fee.withdraw(user1Addr, 100);
    expect((await fee.userDeposit(user1Addr, deployerAddr)).amount, 'amount should be equal').be.equal('0');
  });
});
