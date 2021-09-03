import type { Artifacts } from 'hardhat/types';
import type Web3 from 'web3';
import { assert, expect } from 'chai';
import { upTimestamp } from './utils';

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
  let user: any;
  let withdrawDelay: any;

  before(async () => {
    const accounts = await web3.eth.getAccounts();
    deployer = accounts[0];
    user = accounts[1];
  });

  it('should deploy succeed', async () => {
    config = new web3.eth.Contract(Config.abi, (await Config.new()).address, { from: deployer });
    await config.methods.setSystemCaller(deployer).send();
    fee = new web3.eth.Contract(Fee.abi, (await Fee.new(config.options.address)).address, { from: deployer });
    feeManager = new web3.eth.Contract(FeeManager.abi, (await FeeManager.new(config.options.address)).address, { from: deployer });
    await config.methods.setFeeManager(feeManager.options.address).send();
    expect(await config.methods.feeManager().call(), 'fee manager address should be equal').be.equal(feeManager.options.address);
    withdrawDelay = Number(await config.methods.withdrawDelay().call());
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
    await feeManager.methods.deposit(user).send({ value: 100 });
    expect((await feeManager.methods.userDeposit(user, deployer).call()).amount, 'amount should be equal').be.equal('100');
    expect(await feeManager.methods.totalAmount().call(), 'total amount should be equal').be.equal('100');
  });

  it('should withdraw failed(withdrawFrom)', async () => {
    try {
      await feeManager.methods.withdraw(100, user).send();
      assert.fail("shouldn't succeed");
    } catch (err) {}
  });

  it('should withdraw succeed(withdrawFrom)', async () => {
    await upTimestamp(deployer, withdrawDelay);
    await feeManager.methods.withdraw(100, user).send();
    expect((await feeManager.methods.userDeposit(deployer, deployer).call()).amount, 'amount should be equal').be.equal('0');
    expect(await feeManager.methods.totalAmount().call(), 'total amount should be equal').be.equal('0');
  });
});
