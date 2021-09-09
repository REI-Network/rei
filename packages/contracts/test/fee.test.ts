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
  let user2: any;
  let user3: any;
  let withdrawDelay: any;
  let dailyFee!: BN;
  let feeRecoverInterval!: number;
  let dailyFreeFee!: BN;
  let userFreeFeeLimit!: BN;
  let freeFeeRecoverInterval!: number;

  async function timestamp() {
    return Number(await config.methods.blockTimestamp().call());
  }

  before(async () => {
    const accounts = await web3.eth.getAccounts();
    deployer = accounts[0];
    user1 = accounts[1];
    user2 = accounts[2];
    user3 = accounts[3];
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
    dailyFreeFee = toBN(await config.methods.dailyFreeFee().call());
    userFreeFeeLimit = toBN(await config.methods.userFreeFeeLimit().call());
    freeFeeRecoverInterval = Number(await config.methods.freeFeeRecoverInterval().call());
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

  it('should withdraw failed(can not pay off debt)', async () => {
    await fee.methods.deposit(deployer).send({ value: '100' });
    await fee.methods.deposit(user1).send({ value: '100' });
    await upTimestamp(deployer, withdrawDelay);
    await fee.methods.consume(deployer, dailyFee.divn(2).toString()).send();
    await fee.methods.consume(user1, dailyFee.divn(2).toString()).send();
    await fee.methods.deposit(user2).send({ value: '200' });
    try {
      await fee.methods.withdraw(100, user1).send();
      assert.fail("shouldn't succeed");
    } catch (err) {}
    await upTimestamp(deployer, feeRecoverInterval);
    await fee.methods.withdraw(100, deployer).send();
    await fee.methods.withdraw(100, user1).send();
    await fee.methods.withdraw(200, user2).send();
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

  it('should estimate TotalLeft correctly', async () => {
    let timeSign = await timestamp();
    const totalLeft1 = toBN(await freeFee.methods.estimateTotalLeft(timeSign).call());
    expect(totalLeft1.eq(dailyFreeFee), 'total left free fee should be equal').be.true;

    timeSign = await timestamp();
    await freeFee.methods.consume(deployer, dailyFreeFee.divn(4).toString()).send();
    const totalLeft2 = toBN(await freeFee.methods.estimateTotalLeft(timeSign).call());
    expect(totalLeft2.eq(dailyFreeFee.sub(dailyFreeFee.divn(4))), 'total left free fee should be equal');

    timeSign = await timestamp();
    await freeFee.methods.consume(user1, dailyFreeFee.divn(4).toString()).send();
    const totalLeft3 = toBN(await freeFee.methods.estimateTotalLeft(timeSign).call());
    expect(totalLeft3.eq(totalLeft2.sub(dailyFreeFee.divn(4))), 'total left free fee should be equal');

    timeSign = await timestamp();
    await freeFee.methods.consume(user2, dailyFreeFee.divn(4).toString()).send();
    const totalLeft4 = toBN(await freeFee.methods.estimateTotalLeft(timeSign).call());
    expect(totalLeft4.eqn(0), 'total left free fee should be 0');

    try {
      await freeFee.methods.consume(user3, 100).send();
      assert.fail("shouldn't succeed");
    } catch (err) {}

    await upTimestamp(deployer, freeFeeRecoverInterval);

    const totalLeft5 = toBN(await freeFee.methods.estimateTotalLeft(timeSign).call());
    expect(totalLeft5.eq(dailyFreeFee), 'total left free fee should be equal').be.true;
  });

  it('should estimate Usage correctly', async () => {
    await freeFee.methods.onAfterBlock().call();

    await freeFee.methods.consume(deployer, dailyFreeFee.divn(4).toString()).send();
    let ui = await freeFee.methods.userUsage(deployer).call();
    const usage1 = toBN(await freeFee.methods.estimateUsage(ui, await timestamp()).call());
    expect(usage1.eq(dailyFreeFee.divn(4)), 'usage should be equal');

    await freeFee.methods.onAfterBlock().call();
    await freeFee.methods.consume(deployer, dailyFreeFee.divn(8).toString()).send();
    ui = await freeFee.methods.userUsage(deployer).call();
    const usage2 = toBN(await freeFee.methods.estimateUsage(ui, await timestamp()).call());
    expect(usage2.eq(dailyFreeFee.divn(8).add(dailyFreeFee.divn(4))), 'usage should be equal');

    await upTimestamp(deployer, freeFeeRecoverInterval);
    await freeFee.methods.onAfterBlock().call();
    ui = await freeFee.methods.userUsage(deployer).call();
    const usage3 = toBN(await freeFee.methods.estimateUsage(ui, await timestamp()).call());
    expect(usage3.eqn(0), 'usage should be equal');
  });

  it('should estimate FreeFee correctly', async () => {
    await freeFee.methods.onAfterBlock().call();
    let timeSign = await timestamp();
    const deployerFee1 = toBN(await freeFee.methods.estimateFreeFee(deployer, timeSign).call());
    const user1Fee1 = toBN(await freeFee.methods.estimateFreeFee(user1, timeSign).call());
    expect(deployerFee1.eq(userFreeFeeLimit), 'user free fee should be equal');
    expect(user1Fee1.eq(userFreeFeeLimit), 'user free fee should be equal');

    await freeFee.methods.consume(deployer, dailyFreeFee.divn(3).toString()).send();
    await freeFee.methods.onAfterBlock().call();
    timeSign = await timestamp();
    const deployerFee2 = toBN(await freeFee.methods.estimateFreeFee(deployer, timeSign).call());
    expect(deployerFee2.eq(deployerFee1.sub(dailyFreeFee.divn(3))), 'user free fee should be equal');

    await freeFee.methods.consume(user1, dailyFreeFee.divn(2).toString()).send();
    await freeFee.methods.onAfterBlock().call();
    timeSign = await timestamp();
    const user1Fee2 = toBN(await freeFee.methods.estimateFreeFee(deployer, timeSign).call());
    expect(user1Fee2.eq(user1Fee1.sub(dailyFreeFee.divn(2))), 'user free fee should be equal');

    await freeFee.methods.onAfterBlock().call();
    timeSign = await timestamp();
    const user2Fee1 = toBN(await freeFee.methods.estimateFreeFee(user2, timeSign).call());
    expect(user2Fee1.eq(dailyFreeFee.sub(dailyFreeFee.divn(2)).sub(dailyFreeFee.divn(3))), 'user free fee should be equal');
  });
});
