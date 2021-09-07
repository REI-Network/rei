import type { Artifacts } from 'hardhat/types';
import type Web3 from 'web3';
import { assert, expect } from 'chai';
import { BN } from 'ethereumjs-util';
import { toBN, upTimestamp } from './utils';

declare var artifacts: Artifacts;
declare var web3: Web3;

const Config = artifacts.require('Config_test');
const FeeToken = artifacts.require('FeeToken');
const Fee = artifacts.require('Fee');
const FreeFee = artifacts.require('FreeFee');

describe('Fee', () => {
  let config: any;
  let feeToken: any;
  let fee: any;
  let freeFee: any;
  let deployer: any;
  let user1: any;
  let withdrawDelay: any;
  let dailyFee!: BN;
  let feeRecoverInterval!: number;

  async function timestamp() {
    return Number(await config.methods.blockTimestamp().call());
  }

  before(async () => {
    const accounts = await web3.eth.getAccounts();
    deployer = accounts[0];
    user1 = accounts[1];
  });

  it('should deploy succeed', async () => {
    config = new web3.eth.Contract(Config.abi, (await Config.new()).address, { from: deployer });
    await config.methods.setRouter(deployer).send();
    feeToken = new web3.eth.Contract(FeeToken.abi, (await FeeToken.new(config.options.address)).address, { from: deployer });

    fee = new web3.eth.Contract(Fee.abi, (await Fee.new(config.options.address)).address, { from: deployer });
    await config.methods.setFee(fee.options.address).send();
    expect(await config.methods.fee().call(), 'fee address should be equal').be.equal(fee.options.address);

    freeFee = new web3.eth.Contract(FreeFee.abi, (await FreeFee.new(config.options.address)).address, { from: deployer });
    await config.methods.setFreeFee(freeFee.options.address).send();
    expect(await config.methods.freeFee().call(), 'free fee address should be equal').be.equal(freeFee.options.address);

    withdrawDelay = Number(await config.methods.withdrawDelay().call());
    dailyFee = toBN(await config.methods.dailyFee().call());
    feeRecoverInterval = Number(await config.methods.feeRecoverInterval().call());
  });

  it('should deposit succeed', async () => {
    await fee.methods.deposit(deployer).send({ value: '100' });
    expect((await fee.methods.userDeposit(deployer, deployer).call()).amount, 'amount should be equal').be.equal('100');
    expect(await fee.methods.totalAmount().call(), 'total amount should be equal').be.equal('100');
  });

  it('should withdraw failed', async () => {
    try {
      await fee.methods.withdraw(100, deployer).send();
      assert.fail("shouldn't succeed");
    } catch (err) {}
  });

  it('should withdraw succeed', async () => {
    await upTimestamp(deployer, withdrawDelay);
    await fee.methods.withdraw(100, deployer).send();
    expect((await fee.methods.userDeposit(deployer, deployer).call()).amount, 'amount should be equal').be.equal('0');
    expect(await fee.methods.totalAmount().call(), 'total amount should be equal').be.equal('0');
  });

  it('should deposit succeed(depositTo)', async () => {
    await fee.methods.deposit(user1).send({ value: 100 });
    expect((await fee.methods.userDeposit(user1, deployer).call()).amount, 'amount should be equal').be.equal('100');
    expect(await fee.methods.totalAmount().call(), 'total amount should be equal').be.equal('100');
  });

  it('should withdraw failed(withdrawFrom)', async () => {
    try {
      await fee.methods.withdraw(100, user1).send();
      assert.fail("shouldn't succeed");
    } catch (err) {}
  });

  it('should withdraw succeed(withdrawFrom)', async () => {
    await upTimestamp(deployer, withdrawDelay);
    await fee.methods.withdraw(100, user1).send();
    expect((await fee.methods.userDeposit(user1, deployer).call()).amount, 'amount should be equal').be.equal('0');
    expect(await fee.methods.totalAmount().call(), 'total amount should be equal').be.equal('0');
  });

  it('should estimate correctly', async () => {
    await fee.methods.deposit(deployer).send({ value: '100' });
    await fee.methods.deposit(user1).send({ value: '100' });
    const feeAmount = toBN(await fee.methods.estimateFee(deployer, await timestamp()).call());
    expect(feeAmount.toString(), 'user fee should be equal').be.equal(dailyFee.divn(2).toString());

    await fee.methods.consume(deployer, feeAmount.divn(4).toString()).send();
    const timeSign1 = (await fee.methods.userUsage(deployer).call()).timestamp;
    const feeAmount2 = toBN(await fee.methods.estimateFee(deployer, timeSign1).call());
    expect(feeAmount2.toString(), 'user fee should be equal').be.equal(dailyFee.divn(2).sub(feeAmount.divn(4)).toString());

    // sleep a while
    await upTimestamp(deployer, feeRecoverInterval / 2);
    // after sleep feeRecoverInterval / 2, userUsage should be userAccUsage / 2
    const userUsage = feeAmount.divn(4).divn(2);
    const feeAmount3 = toBN(await fee.methods.estimateFee(deployer, Number(timeSign1) + feeRecoverInterval / 2).call());
    expect(feeAmount3.toString(), 'user fee should be equal').be.equal(dailyFee.divn(2).sub(userUsage).toString());

    await fee.methods.consume(deployer, feeAmount.divn(4).toString()).send();
    const timeSign2 = (await fee.methods.userUsage(deployer).call()).timestamp;
    const userUsage2 = feeAmount.divn(4).add(
      feeAmount.divn(4).sub(
        feeAmount
          .divn(4)
          .muln(Number(timeSign2) - Number(timeSign1))
          .divn(feeRecoverInterval)
      )
    );
    const feeAmount4 = toBN(await fee.methods.estimateFee(deployer, Number(timeSign2)).call());
    expect(feeAmount4.eq(dailyFee.divn(2).sub(userUsage2)), 'user fee should be equal').be.true;
  });
});
