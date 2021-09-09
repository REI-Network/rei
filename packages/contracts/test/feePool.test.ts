import type { Artifacts } from 'hardhat/types';
import type Web3 from 'web3';
import { assert, expect } from 'chai';
import { BN } from 'ethereumjs-util';
import { toBN, upTimestamp } from './utils';

declare var artifacts: Artifacts;
declare var web3: Web3;

const Config = artifacts.require('Config_test');
const FeePool = artifacts.require('FeePool');
const StakeManager = artifacts.require('StakeManager');
const ValidatorRewardPool = artifacts.require('ValidatorRewardPool');

describe('FeePool', () => {
  let config: any;
  let feePool: any;
  let deployer: any;
  let stakeManager: any;
  let validatorRewardPool: any;
  let validator1: any;
  let validator2: any;
  let validator3: any;
  const earnedAmount = 100;
  const accumulateAmount = 300;

  async function timestamp() {
    return Number(await config.methods.blockTimestamp().call());
  }

  before(async () => {
    const accounts = await web3.eth.getAccounts();
    deployer = accounts[0];
    validator1 = accounts[1];
    validator2 = accounts[2];
    validator3 = accounts[3];
  });

  it('should deploy succeed', async () => {
    config = new web3.eth.Contract(Config.abi, (await Config.new()).address, { from: deployer });
    await config.methods.setRouter(deployer).send();

    stakeManager = new web3.eth.Contract(StakeManager.abi, (await StakeManager.new(config.options.address, [])).address, { from: deployer });
    await config.methods.setStakeManager(stakeManager.options.address).send();

    feePool = new web3.eth.Contract(FeePool.abi, (await FeePool.new(config.options.address)).address, { from: deployer });
    await config.methods.setFeePool(feePool.options.address).send();

    validatorRewardPool = new web3.eth.Contract(ValidatorRewardPool.abi, (await ValidatorRewardPool.new(config.options.address)).address, { from: deployer });
    await config.methods.setValidatorRewardPool(validatorRewardPool.options.address).send();

    expect(await config.methods.feePool().call(), 'fee pool address should be equal').be.equal(feePool.options.address);
  });

  it('should get validators length correctly', async () => {
    await feePool.methods.earn(validator1, earnedAmount).send();
    let validatorsLength = toBN(await feePool.methods.validatorsLength().call());
    const fee1 = await feePool.methods.totalShares().call();
    expect(validatorsLength.eqn(1), 'validators length should be equal').be.true;

    await feePool.methods.earn(validator2, earnedAmount).send();
    validatorsLength = toBN(await feePool.methods.validatorsLength().call());
    expect(validatorsLength.eqn(2), 'validators length should be equal').be.true;

    await feePool.methods.earn(validator3, earnedAmount).send();
    validatorsLength = toBN(await feePool.methods.validatorsLength().call());
    expect(validatorsLength.eqn(3), 'validators length should be equal').be.true;
  });

  it('should earn correctly', async () => {
    let totalShares = toBN(await feePool.methods.totalShares().call());
    let validator2Shares = toBN(await feePool.methods.sharesOf(validator2).call());
    let validator3Shares = toBN(await feePool.methods.sharesOf(validator3).call());
    expect(totalShares.eqn(3 * earnedAmount), 'totalShares should be equal1').be.true;
    expect(validator2Shares.eqn(earnedAmount), 'validator2 shares should be equal').be.true;
    expect(validator3Shares.eqn(earnedAmount), 'validator3 shares should be equal').be.true;

    await feePool.methods.earn(validator2, earnedAmount).send();
    totalShares = toBN(await feePool.methods.totalShares().call());
    validator2Shares = toBN(await feePool.methods.sharesOf(validator2).call());
    expect(totalShares.eqn(4 * earnedAmount), 'totalShares should be equal2').be.true;
    expect(validator2Shares.eqn(earnedAmount * 2), 'validator2 shares should be equal').be.true;

    await feePool.methods.earn(validator3, earnedAmount * 2).send();
    totalShares = toBN(await feePool.methods.totalShares().call());
    validator3Shares = toBN(await feePool.methods.sharesOf(validator3).call());
    expect(totalShares.eqn(6 * earnedAmount), 'totalShares should be equal3').be.true;
    expect(validator3Shares.eqn(earnedAmount * 3), 'validator3 shares should be equal').be.true;
  });

  it('should accumulate correctly', async () => {
    let poolBalance = await web3.eth.getBalance(feePool.options.address);
    let accTxFee = toBN(await feePool.methods.accTxFee().call());
    expect(poolBalance, 'pool balance should be equal').be.equal('0');
    expect(accTxFee.eqn(0), 'accTxFee should be euqal').be.true;

    await feePool.methods.accumulate(true).send({ value: accumulateAmount });
    poolBalance = await web3.eth.getBalance(feePool.options.address);
    accTxFee = toBN(await feePool.methods.accTxFee().call());
    expect(poolBalance, 'pool balance should be equal').be.equal('300');
    expect(accTxFee.eqn(accumulateAmount), 'accTxFee should be euqal').be.true;

    await feePool.methods.accumulate(false).send({ value: accumulateAmount });
    poolBalance = await web3.eth.getBalance(feePool.options.address);
    accTxFee = toBN(await feePool.methods.accTxFee().call());
    expect(poolBalance, 'pool balance should be equal').be.equal('600');
    expect(accTxFee.eqn(accumulateAmount), 'accTxFee should be euqal').be.true;
  });

  it('should onAssignBlockReward correctly', async () => {
    const validator1Rate = 40;
    const validator2Rate = 50;
    const validator3Rate = 60;

    const poolBalanceBefore = await web3.eth.getBalance(feePool.options.address);
    const totalSharesBefore = toBN(await feePool.methods.totalShares().call());
    const accTxFeeBefore = toBN(await feePool.methods.accTxFee().call());
    const globalTimestampBefore = toBN(await feePool.methods.globalTimestamp().call());
    const validator1SharesBefore = toBN(await feePool.methods.sharesOf(validator1).call());
    const validator2SharesBefore = toBN(await feePool.methods.sharesOf(validator2).call());
    const validator3SharesBefore = toBN(await feePool.methods.sharesOf(validator3).call());
    expect(validator1SharesBefore.eqn(earnedAmount), 'validator1 shares should be equal').be.true;
    expect(validator2SharesBefore.eqn(earnedAmount * 2), 'validator2 shares should be equal').be.true;
    expect(validator3SharesBefore.eqn(earnedAmount * 3), 'validator3 shares should be equal').be.true;
    expect(poolBalanceBefore, 'pool balance should be equal').be.equal('600');
    expect(totalSharesBefore.eqn(6 * earnedAmount), 'totalShares should be euqal').be.true;
    expect(accTxFeeBefore.eqn(accumulateAmount), 'accTxFee should be euqal').be.true;

    await stakeManager.methods.stake(validator1, deployer).send({ value: 1000 });
    await stakeManager.methods.stake(validator2, deployer).send({ value: 1000 });
    await stakeManager.methods.stake(validator3, deployer).send({ value: 1000 });
    await stakeManager.methods.setCommissionRate(validator1Rate).send({ from: validator1 });
    await stakeManager.methods.setCommissionRate(validator2Rate).send({ from: validator2 });
    await stakeManager.methods.setCommissionRate(validator3Rate).send({ from: validator3 });
    await feePool.methods.onAssignBlockReward().send();

    const validator1Reward = toBN(await validatorRewardPool.methods.balanceOf(validator1).call());
    const validator2Reward = toBN(await validatorRewardPool.methods.balanceOf(validator2).call());
    const validator3Reward = toBN(await validatorRewardPool.methods.balanceOf(validator3).call());
    const validator1RewardCal = validator1SharesBefore
      .mul(accTxFeeBefore)
      .muln(2)
      .div(totalSharesBefore)
      .muln(100 - validator1Rate)
      .divn(100);
    const validator2RewardCal = validator2SharesBefore
      .mul(accTxFeeBefore)
      .muln(2)
      .div(totalSharesBefore)
      .muln(100 - validator2Rate)
      .divn(100);
    const validator3RewardCal = validator3SharesBefore
      .mul(accTxFeeBefore)
      .muln(2)
      .div(totalSharesBefore)
      .muln(100 - validator3Rate)
      .divn(100);
    expect(validator1Reward.eq(validator1RewardCal), 'validator1 reward should be equal to computation').be.true;
    expect(validator2Reward.eq(validator2RewardCal), 'validator2 reward should be equal to computation').be.true;
    expect(validator3Reward.eq(validator3RewardCal), 'validator3 reward should be equal to computation').be.true;

    const poolBalanceAfter = await web3.eth.getBalance(feePool.options.address);
    const totalSharesAfter = toBN(await feePool.methods.totalShares().call());
    const accTxFeeAfter = toBN(await feePool.methods.accTxFee().call());
    const globalTimestampAfter = toBN(await feePool.methods.globalTimestamp().call());
    const validator1SharesAfter = toBN(await feePool.methods.sharesOf(validator1).call());
    const validator2SharesAfter = toBN(await feePool.methods.sharesOf(validator2).call());
    const validator3SharesAfter = toBN(await feePool.methods.sharesOf(validator3).call());
    expect(validator1SharesAfter.eqn(0), 'validator1 shares should be equal').be.true;
    expect(validator2SharesAfter.eqn(0), 'validator2 shares should be equal').be.true;
    expect(validator3SharesAfter.eqn(0), 'validator3 shares should be equal').be.true;
    expect(poolBalanceAfter, 'pool balance should be equal').be.equal('0');
    expect(totalSharesAfter.eqn(0), 'totalShares should be euqal').be.true;
    expect(accTxFeeAfter.eqn(0), 'accTxFee should be euqal').be.true;
    expect(globalTimestampAfter.gt(globalTimestampBefore), 'global timestamp should be changed').be.true;
  });
});
