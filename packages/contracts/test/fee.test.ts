import type Web3 from 'web3';
import { assert, expect } from 'chai';
import { upTimestamp } from './utils';

declare var artifacts: any;
declare var web3: Web3;

const Config = artifacts.require('Config_devnet');
const Fee = artifacts.require('Fee');

describe('Fee', () => {
  let config: any;
  let fee: any;
  let deployer: any;
  let user1: any;
  let withdrawDelay: any;

  before(async () => {
    const accounts = await web3.eth.getAccounts();
    deployer = accounts[0];
    user1 = accounts[1];
  });

  it('should deploy succeed', async () => {
    config = new web3.eth.Contract(Config.abi, (await Config.new()).address, { from: deployer });
    await config.methods.setSystemCaller(deployer).send();

    fee = new web3.eth.Contract(Fee.abi, (await Fee.new(config.options.address)).address, { from: deployer });
    await config.methods.setFee(fee.options.address).send();
    expect(await config.methods.fee().call(), 'fee address should be equal').be.equal(fee.options.address);

    withdrawDelay = 3;
    await config.methods.setWithdrawDelay(withdrawDelay).send({ from: deployer });
    expect(await config.methods.withdrawDelay().call(), 'withdraw delay should be equal').be.equal(withdrawDelay.toString());
  });

  it('should deposit succeed', async () => {
    await fee.methods.deposit(deployer).send({ value: '100' });
    expect((await fee.methods.userDeposit(deployer, deployer).call()).amount, 'amount should be equal').be.equal('100');
  });

  it('should withdraw failed', async () => {
    try {
      await fee.methods.withdraw(deployer, 100).send();
      assert.fail("shouldn't succeed");
    } catch (err) {}
  });

  it('should withdraw succeed', async () => {
    await upTimestamp(deployer, withdrawDelay);
    await fee.methods.withdraw(deployer, 100).send();
    expect((await fee.methods.userDeposit(deployer, deployer).call()).amount, 'amount should be equal').be.equal('0');
  });

  it('should deposit succeed(depositTo)', async () => {
    await fee.methods.deposit(user1).send({ value: 100 });
    expect((await fee.methods.userDeposit(user1, deployer).call()).amount, 'amount should be equal').be.equal('100');
  });

  it('should withdraw failed(withdrawFrom)', async () => {
    try {
      await fee.methods.withdraw(user1, 100).send();
      assert.fail("shouldn't succeed");
    } catch (err) {}
  });

  it('should withdraw succeed(withdrawFrom)', async () => {
    await upTimestamp(deployer, withdrawDelay);
    await fee.methods.withdraw(user1, 100).send();
    expect((await fee.methods.userDeposit(user1, deployer).call()).amount, 'amount should be equal').be.equal('0');
  });
});
