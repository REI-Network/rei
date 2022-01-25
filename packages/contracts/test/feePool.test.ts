import type Web3 from 'web3';
import { expect } from 'chai';
import { toBN, upTimestamp } from './utils';

declare var artifacts: any;
declare var web3: Web3;

const Config = artifacts.require('Config_devnet');
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

  before(async () => {
    const accounts = await web3.eth.getAccounts();
    deployer = accounts[0];
    validator1 = accounts[1];
    validator2 = accounts[2];
    validator3 = accounts[3];
  });

  it('should deploy succeed', async () => {
    config = new web3.eth.Contract(Config.abi, (await Config.new()).address, { from: deployer });
    await config.methods.setSystemCaller(deployer).send();
    await config.methods.setFeePoolInterval(10000).send();

    stakeManager = new web3.eth.Contract(StakeManager.abi, (await StakeManager.new(config.options.address, deployer, [], [])).address, { from: deployer });
    await config.methods.setStakeManager(stakeManager.options.address).send();

    feePool = new web3.eth.Contract(FeePool.abi, (await FeePool.new(config.options.address)).address, { from: deployer });
    await config.methods.setFeePool(feePool.options.address).send();

    validatorRewardPool = new web3.eth.Contract(ValidatorRewardPool.abi, (await ValidatorRewardPool.new(config.options.address)).address, { from: deployer });
    await config.methods.setValidatorRewardPool(validatorRewardPool.options.address).send();

    expect(await config.methods.feePoolInterval().call(), 'fee pool interval should be equal').be.equal('10000');
    expect(await config.methods.stakeManager().call(), 'stake manager address should be equal').be.equal(stakeManager.options.address);
    expect(await config.methods.feePool().call(), 'fee pool address should be equal').be.equal(feePool.options.address);
    expect(await config.methods.validatorRewardPool().call(), 'validator reward pool address should be equal').be.equal(validatorRewardPool.options.address);
  });

  it('should get validators length correctly', async () => {
    await feePool.methods.distribute(validator1, 0).send();
    let validatorsLength = toBN(await feePool.methods.validatorsLength().call());
    expect(validatorsLength.eqn(0), 'validators length should be equal').be.true;

    await feePool.methods.distribute(validator1, 100).send();
    validatorsLength = toBN(await feePool.methods.validatorsLength().call());
    expect(validatorsLength.eqn(1), 'validators length should be equal').be.true;

    await feePool.methods.distribute(validator2, 100).send();
    validatorsLength = toBN(await feePool.methods.validatorsLength().call());
    expect(validatorsLength.eqn(2), 'validators length should be equal').be.true;

    await feePool.methods.distribute(validator3, 100).send();
    validatorsLength = toBN(await feePool.methods.validatorsLength().call());
    expect(validatorsLength.eqn(3), 'validators length should be equal').be.true;
  });

  it('should distribute correctly(1)', async () => {
    let totalShares = toBN(await feePool.methods.totalShares().call());
    let validator2Shares = toBN(await feePool.methods.sharesOf(validator2).call());
    let validator3Shares = toBN(await feePool.methods.sharesOf(validator3).call());
    expect(totalShares.eqn(300), 'totalShares should be equal1').be.true;
    expect(validator2Shares.eqn(100), 'validator2 shares should be equal').be.true;
    expect(validator3Shares.eqn(100), 'validator3 shares should be equal').be.true;

    await feePool.methods.distribute(validator2, 100).send();
    totalShares = toBN(await feePool.methods.totalShares().call());
    validator2Shares = toBN(await feePool.methods.sharesOf(validator2).call());
    expect(totalShares.eqn(400), 'totalShares should be equal2').be.true;
    expect(validator2Shares.eqn(200), 'validator2 shares should be equal').be.true;

    await feePool.methods.distribute(validator3, 200).send();
    totalShares = toBN(await feePool.methods.totalShares().call());
    validator3Shares = toBN(await feePool.methods.sharesOf(validator3).call());
    expect(totalShares.eqn(600), 'totalShares should be equal3').be.true;
    expect(validator3Shares.eqn(300), 'validator3 shares should be equal').be.true;
  });

  it('should accumulate correctly(2)', async () => {
    let poolBalance = await web3.eth.getBalance(feePool.options.address);
    expect(poolBalance, 'pool balance should be equal').be.equal('0');

    await feePool.methods.distribute(validator1, 0).send({ value: 600 });
    poolBalance = await web3.eth.getBalance(feePool.options.address);
    expect(poolBalance, 'pool balance should be equal').be.equal('600');
  });

  it('should accumulate correctly(3)', async () => {
    const validator1Rate = 40;
    const validator2Rate = 50;
    const validator3Rate = 60;

    const poolBalanceBefore = toBN(await web3.eth.getBalance(feePool.options.address));
    const totalSharesBefore = toBN(await feePool.methods.totalShares().call());
    const globalTimestampBefore = toBN(await feePool.methods.globalTimestamp().call());
    const validator1SharesBefore = toBN(await feePool.methods.sharesOf(validator1).call());
    const validator2SharesBefore = toBN(await feePool.methods.sharesOf(validator2).call());
    const validator3SharesBefore = toBN(await feePool.methods.sharesOf(validator3).call());
    expect(validator1SharesBefore.eqn(100), 'validator1 shares should be equal').be.true;
    expect(validator2SharesBefore.eqn(200), 'validator2 shares should be equal').be.true;
    expect(validator3SharesBefore.eqn(300), 'validator3 shares should be equal').be.true;
    expect(poolBalanceBefore.eqn(600), 'pool balance should be equal').be.true;
    expect(totalSharesBefore.eqn(600), 'totalShares should be euqal').be.true;

    await stakeManager.methods.stake(validator1, deployer).send({ value: 1000 });
    await stakeManager.methods.stake(validator2, deployer).send({ value: 1000 });
    await stakeManager.methods.stake(validator3, deployer).send({ value: 1000 });
    await stakeManager.methods.setCommissionRate(validator1Rate).send({ from: validator1 });
    await stakeManager.methods.setCommissionRate(validator2Rate).send({ from: validator2 });
    await stakeManager.methods.setCommissionRate(validator3Rate).send({ from: validator3 });

    await config.methods.setFeePoolInterval(2).send();
    await feePool.methods.distribute(validator1, 0).send();

    const validator1Reward = toBN(await validatorRewardPool.methods.balanceOf(validator1).call());
    const validator2Reward = toBN(await validatorRewardPool.methods.balanceOf(validator2).call());
    const validator3Reward = toBN(await validatorRewardPool.methods.balanceOf(validator3).call());
    const _validator1Reward = poolBalanceBefore
      .mul(validator1SharesBefore)
      .div(totalSharesBefore)
      .muln(100 - validator1Rate)
      .divn(100);
    const _validator2Reward = poolBalanceBefore
      .mul(validator2SharesBefore)
      .div(totalSharesBefore)
      .muln(100 - validator2Rate)
      .divn(100);
    const _validator3Reward = poolBalanceBefore
      .mul(validator3SharesBefore)
      .div(totalSharesBefore)
      .muln(100 - validator3Rate)
      .divn(100);
    expect(validator1Reward.eq(_validator1Reward), 'validator1 reward should be equal to computation').be.true;
    expect(validator2Reward.eq(_validator2Reward), 'validator2 reward should be equal to computation').be.true;
    expect(validator3Reward.eq(_validator3Reward), 'validator3 reward should be equal to computation').be.true;

    const poolBalanceAfter = toBN(await web3.eth.getBalance(feePool.options.address));
    const totalSharesAfter = toBN(await feePool.methods.totalShares().call());
    const globalTimestampAfter = toBN(await feePool.methods.globalTimestamp().call());
    const validator1SharesAfter = toBN(await feePool.methods.sharesOf(validator1).call());
    const validator2SharesAfter = toBN(await feePool.methods.sharesOf(validator2).call());
    const validator3SharesAfter = toBN(await feePool.methods.sharesOf(validator3).call());
    expect(validator1SharesAfter.eqn(0), 'validator1 shares should be equal').be.true;
    expect(validator2SharesAfter.eqn(0), 'validator2 shares should be equal').be.true;
    expect(validator3SharesAfter.eqn(0), 'validator3 shares should be equal').be.true;
    expect(poolBalanceAfter.eqn(0), 'pool balance should be equal').be.true;
    expect(totalSharesAfter.eqn(0), 'totalShares should be euqal').be.true;
    expect(globalTimestampAfter.gt(globalTimestampBefore), 'global timestamp should be changed').be.true;
  });
});
