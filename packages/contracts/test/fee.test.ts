import type { Artifacts } from 'hardhat/types';
import type Web3 from 'web3';
import { assert, expect } from 'chai';
import { BN } from 'ethereumjs-util';
import { toBN, upTimestamp } from './utils';

declare var artifacts: Artifacts;
declare var web3: Web3;

const Config = artifacts.require('Config_test');
const Fee = artifacts.require('Fee');
const FeeManager = artifacts.require('FeeManager');

describe('Fee', () => {
  let config: any;
  let fee: any;
  let feeManager: any;
  let deployer: any;
  let user1: any;
  let withdrawDelay: any;
  let dailyFee!: BN;
  let feeRecoverInterval!: number;

  before(async () => {
    const accounts = await web3.eth.getAccounts();
    deployer = accounts[0];
    user1 = accounts[1];
  });

  it('should deploy succeed', async () => {
    config = new web3.eth.Contract(Config.abi, (await Config.new()).address, { from: deployer });
    await config.methods.setSystemCaller(deployer).send();
    fee = new web3.eth.Contract(Fee.abi, (await Fee.new(config.options.address)).address, { from: deployer });
    feeManager = new web3.eth.Contract(FeeManager.abi, (await FeeManager.new(config.options.address)).address, { from: deployer });
    await config.methods.setFeeManager(feeManager.options.address).send();
    expect(await config.methods.feeManager().call(), 'fee manager address should be equal').be.equal(feeManager.options.address);
    withdrawDelay = Number(await config.methods.withdrawDelay().call());
    dailyFee = toBN(await config.methods.dailyFee().call());
    feeRecoverInterval = Number(await config.methods.feeRecoverInterval().call());
  });

  it('should deposit succeed', async () => {
    await feeManager.methods.deposit(deployer).send({ value: '100' });
    expect((await feeManager.methods.userDeposit(deployer, deployer).call()).amount, 'amount should be equal').be.equal('100');
    expect(await feeManager.methods.totalAmount().call(), 'total amount should be equal').be.equal('100');
  });

  it('should withdraw failed', async () => {
    try {
      await feeManager.methods.withdraw(100, deployer).send();
      assert.fail("shouldn't succeed");
    } catch (err) {}
  });

  it('should withdraw succeed', async () => {
    await upTimestamp(deployer, withdrawDelay);
    await feeManager.methods.withdraw(100, deployer).send();
    expect((await feeManager.methods.userDeposit(deployer, deployer).call()).amount, 'amount should be equal').be.equal('0');
    expect(await feeManager.methods.totalAmount().call(), 'total amount should be equal').be.equal('0');
  });

  it('should deposit succeed(depositTo)', async () => {
    await feeManager.methods.deposit(user1).send({ value: 100 });
    expect((await feeManager.methods.userDeposit(user1, deployer).call()).amount, 'amount should be equal').be.equal('100');
    expect(await feeManager.methods.totalAmount().call(), 'total amount should be equal').be.equal('100');
  });

  it('should withdraw failed(withdrawFrom)', async () => {
    try {
      await feeManager.methods.withdraw(100, user1).send();
      assert.fail("shouldn't succeed");
    } catch (err) {}
  });

  it('should withdraw succeed(withdrawFrom)', async () => {
    await upTimestamp(deployer, withdrawDelay);
    await feeManager.methods.withdraw(100, user1).send();
    expect((await feeManager.methods.userDeposit(user1, deployer).call()).amount, 'amount should be equal').be.equal('0');
    expect(await feeManager.methods.totalAmount().call(), 'total amount should be equal').be.equal('0');
  });

  it('should estimate correctly', async () => {
    await feeManager.methods.deposit(deployer).send({ value: '100' });
    await feeManager.methods.deposit(user1).send({ value: '100' });
    const fee = toBN(await feeManager.methods.estimateFee(deployer).call());
    expect(fee.toString(), 'user fee should be equal').be.equal(dailyFee.divn(2).toString());

    await feeManager.methods.consume(deployer, fee.divn(4).toString()).send();
    const fee2 = toBN(await feeManager.methods.estimateFee(deployer).call());
    expect(fee2.toString(), 'user fee should be equal').be.equal(dailyFee.divn(2).sub(fee.divn(4)).toString());

    // sleep a while
    await upTimestamp(deployer, feeRecoverInterval / 2);
    // after sleep feeRecoverInterval / 2, userUsage should be userAccUsage / 2
    const userUsage = fee.divn(4).divn(2);
    const fee3 = toBN(await feeManager.methods.estimateFee(deployer).call());
    expect(fee3.toString(), 'user fee should be equal').be.equal(dailyFee.divn(2).sub(userUsage).toString());

    await feeManager.methods.consume(deployer, fee.divn(4).toString()).send();
    const fee4 = toBN(await feeManager.methods.estimateFee(deployer).call());
    expect(fee4.gte(fee3.sub(fee.divn(4))), 'user fee should be greater than estimated value').be.true;
  });
});
