import type { Artifacts } from 'hardhat/types';
import type Web3 from 'web3';
import { assert, expect } from 'chai';
import { BN, MAX_INTEGER } from 'ethereumjs-util';

declare var artifacts: Artifacts;
declare var web3: Web3;

const Config = artifacts.require('Config_test');
const CommissionShare = artifacts.require('CommissionShare');
const UnstakeKeeper = artifacts.require('UnstakeKeeper');
const StakeManager = artifacts.require('StakeManager');
const Estimator = artifacts.require('Estimator');
const ValidatorKeeper = artifacts.require('ValidatorKeeper');

describe('StakeManger', () => {
  let config: any;
  let stakeManager: any;
  let estimator: any;
  let deployer: string;
  let validator1: string;
  let receiver1: string;
  let receiver2: string;
  let genesis1: string;
  let genesis2: string;
  let validator2: string;
  let validator3: string;
  let unstakeDelay: number;
  let minStakeAmount: BN;
  let minUnstakeAmount: BN;
  let minIndexVotingPower: BN;

  async function createCommissionShareContract(validator: string) {
    const v = await stakeManager.methods.validators(validator).call();
    return new web3.eth.Contract(CommissionShare.abi, v.commissionShare, { from: deployer });
  }

  async function createUnstakeKeeperContract(validator: string) {
    const v = await stakeManager.methods.validators(validator).call();
    return new web3.eth.Contract(UnstakeKeeper.abi, v.unstakeKeeper, { from: deployer });
  }

  async function createValidatorKeeperContract(validator: string) {
    const v = await stakeManager.methods.validators(validator).call();
    return new web3.eth.Contract(ValidatorKeeper.abi, v.validatorKeeper, { from: deployer });
  }

  async function upTimestamp(waittime: number) {
    // wait some time and send a transaction to update blockchain timestamp
    await new Promise((r) => setTimeout(r, waittime * 1000 + 10));
    await web3.eth.sendTransaction({
      from: deployer,
      to: deployer,
      value: 0
    });
  }

  function toBN(data: number | string) {
    if (typeof data === 'string' && data.startsWith('0x')) {
      return new BN(data.substr(2), 'hex');
    }
    return new BN(data);
  }

  before(async () => {
    const accounts = await web3.eth.getAccounts();
    deployer = accounts[0];
    validator1 = accounts[1];
    receiver1 = accounts[2];
    receiver2 = accounts[3];
    genesis1 = accounts[4];
    genesis2 = accounts[5];
    validator2 = accounts[6];
    validator3 = accounts[7];
  });

  it('should deploy succeed', async () => {
    config = new web3.eth.Contract(Config.abi, (await Config.new()).address, { from: deployer });
    stakeManager = new web3.eth.Contract(StakeManager.abi, (await StakeManager.new(config.options.address, [genesis1, genesis2])).address, { from: deployer });
    estimator = new web3.eth.Contract(Estimator.abi, await stakeManager.methods.estimator().call(), { from: deployer });
    await config.methods.setStakeManager(stakeManager.options.address).send();
    await config.methods.setSystemCaller(deployer).send();
    unstakeDelay = toBN(await config.methods.unstakeDelay().call()).toNumber();
    minStakeAmount = toBN(await config.methods.minStakeAmount().call());
    minUnstakeAmount = toBN(await config.methods.minUnstakeAmount().call());
    minIndexVotingPower = toBN(await config.methods.minIndexVotingPower().call());
  });

  it('should initialize succeed', async () => {
    expect(await stakeManager.methods.indexedValidatorsLength().call(), 'indexedValidatorsLength should be equal to 0').to.equal('0');
    expect((await stakeManager.methods.validators(genesis1).call()).id, 'genesis validator id should match').to.equal('0');
    expect((await stakeManager.methods.validators(genesis2).call()).id, 'genesis validator id should match').to.equal('1');
  });

  it('should stake failed(min stake amount)', async () => {
    try {
      await stakeManager.methods.stake(validator1, deployer).send({ value: minStakeAmount.subn(1).toString() });
      assert.fail("shouldn't stake succeed");
    } catch (err) {}
  });

  it('should stake succeed', async () => {
    // stake minStakeAmount
    await stakeManager.methods.stake(validator1, deployer).send({ value: minStakeAmount.toString() });
    const shares = await (await createCommissionShareContract(validator1)).methods.balanceOf(deployer).call();
    expect(shares, 'shares should be equal to amount at the time of the first staking').to.equal(minStakeAmount.toString());

    // stake minIndexVotingPower - minStakeAmount
    await stakeManager.methods.stake(validator1, deployer).send({ value: minIndexVotingPower.sub(minStakeAmount).toString() });
    const validatorAddress = await stakeManager.methods.indexedValidatorsById(2).call();
    expect(validatorAddress, 'address should be equal').be.equal(validator1);
    const validatorAddress2 = await stakeManager.methods.indexedValidatorsByIndex(0).call();
    expect(validatorAddress2, 'address should be equal').be.equal(validator1);
  });

  it('should get voting power', async () => {
    const votingPower1 = await stakeManager.methods.getVotingPowerByIndex(0).call();
    expect(votingPower1, 'votingPower1 should be euqal').be.equal(minIndexVotingPower.toString());
    const votingPower2 = await stakeManager.methods.getVotingPowerById(2).call();
    expect(votingPower2, 'votingPower2 should be euqal').be.equal(minIndexVotingPower.toString());
    const votingPower3 = await stakeManager.methods.getVotingPowerByAddress(validator1).call();
    expect(votingPower3, 'votingPower3 should be euqal').be.equal(minIndexVotingPower.toString());
  });

  it('should match validator info', async () => {
    const commissionShare = await createCommissionShareContract(validator1);
    expect(await commissionShare.methods.validator().call(), 'validator address should be equal').to.equal(validator1);
    const unstakeKeeper = await createUnstakeKeeperContract(validator1);
    expect(await unstakeKeeper.methods.validator().call(), 'validator address should be equal').to.equal(validator1);
    const validatorKeeper = await createValidatorKeeperContract(validator1);
    expect(await validatorKeeper.methods.validator().call(), 'validator address should be equal').to.equal(validator1);
  });

  it('should approve succeed', async () => {
    const commissionShare = await createCommissionShareContract(validator1);
    await commissionShare.methods.approve(stakeManager.options.address, MAX_INTEGER.toString()).send();
  });

  it('should get first and last id', async () => {
    // currently, user amount should be minIndexVotingPower
    const stakeAmount = minStakeAmount;
    const unstakeAmount1 = minStakeAmount;
    const unstakeAmount2 = minIndexVotingPower;
    const unstakeAmountArray = [unstakeAmount1, unstakeAmount2];

    await stakeManager.methods.stake(validator1, deployer).send({ value: stakeAmount });
    await stakeManager.methods.startUnstake(validator1, deployer, unstakeAmount1.toString()).send();
    await stakeManager.methods.startUnstake(validator1, deployer, unstakeAmount2.toString()).send();

    await Promise.all(
      unstakeAmountArray.map(async (element, i) => {
        const unstakeInfo = await stakeManager.methods.unstakeQueue(i).call();
        expect(unstakeInfo.validator, 'validator address should be equal').be.equal(validator1);
        expect(unstakeInfo.to, 'to address should be equal').be.equal(deployer);
        expect(unstakeInfo.unstakeShares, 'unStakeAmount address should be equal').be.equal(element.toString());
      })
    );

    await upTimestamp(unstakeDelay);
    await stakeManager.methods.unstake(0).send();
    await stakeManager.methods.unstake(1).send();
    // TODO: check amount
  });

  it('should set commission rate correctly', async () => {
    const oldCommissionRate = 0;
    const newCommissionRate = 50;
    const setInterval = await config.methods.setCommissionRateInterval().call();
    const validatorInfoBefore = await stakeManager.methods.validators(validator1).call();
    expect(validatorInfoBefore.commissionRate, 'commissionRate should be 0').be.equal(oldCommissionRate.toString());
    await stakeManager.methods.setCommissionRate(newCommissionRate).send({ from: validator1 });
    const validatorInfoAfter = await stakeManager.methods.validators(validator1).call();
    expect(validatorInfoAfter.commissionRate, 'commissionRare should be new commissionRate').be.equal(newCommissionRate.toString());

    await upTimestamp(setInterval - 3);
    try {
      await stakeManager.methods.setCommissionRate(oldCommissionRate).send({ from: validator1 });
      assert.fail('update commission rate too frequently');
    } catch (err) {}

    await upTimestamp(3);
    try {
      await stakeManager.methods.setCommissionRate(newCommissionRate).send({ from: validator1 });
      assert.fail('repeatedly set commission rate');
    } catch (err) {}
  });

  it('should estimate correctly', async () => {
    const estimateMinStake = await estimator.methods.estimateMinStakeAmount(validator1).call();
    expect(estimateMinStake, 'mininual stake amount should be equal').equal(minStakeAmount.toString());
    const wantedShares = toBN('97');
    const estimateStake = await estimator.methods.estimateStakeAmount(validator1, wantedShares).call();
    expect(estimateStake, 'estimate shares amount should be equal').be.equal(wantedShares.toString());

    // await stakeManager.methods.stake(validator1, deployer).send({ value: estimateStake });
    // await stakeManager.methods.slash(validator1, 1).send();
    // await stakeManager.methods.reward(validator1).send({ value: 2000 });
    // const estimateMinStake1 = await estimator.methods.estimateMinStakeAmount(validator1).call();
    // expect(estimateMinStake1, 'mininual stake amount should be equal').be.equal('11');
    // const estimateStake1 = await estimator.methods.estimateStakeAmount(validator1, '1').call();
    // expect(estimateStake1, 'estimate stake amount should be equal').be.equal(estimateStake1);

    // await stakeManager.methods.startUnstake(validator1, deployer, wantedShares.toString()).send();
    // const estimateAmount = await estimator.methods.estimateUnstakeAmount(validator1, wantedShares).call();
    // expect(estimateAmount, 'estimateAmount should be equal').be.equal('97');
    // await stakeManager.methods.slash(validator1, 0).send();
    // const estimateAmount1 = await estimator.methods.estimateUnstakeAmount(validator1, wantedShares).call();
    // expect(estimateAmount1, 'estimateAmount should be equal').be.equal('58');

    // await stakeManager.methods.slash(validator1, 1).send();
    // const wantedAmount = toBN(97);
    // await stakeManager.methods.stake(validator1, deployer).send({ value: wantedAmount.toString() });
    // await stakeManager.methods.slash(validator1, 1).send();
    // await stakeManager.methods.reward(validator1).send({ value: 1000 });
    // const estimateUnstakeShare = await estimator.methods.estimateMinUnstakeShares(validator1).call();
    // expect(estimateUnstakeShare, 'estimateUnstakeShare should be equal').be.equal('1');
    // const estimateUnstakeShare1 = await estimator.methods.estimateUnstakeShares(validator1, minUnstakeAmount.toString()).call();
    // expect(estimateUnstakeShare1, 'estimateUnstakeShare1 should be equal').be.equal('1');
  });

  it('should remove and add indexed validator correctly', async () => {
    const isExist = (): Promise<boolean> => {
      return stakeManager.methods.indexedValidatorsExists(3).call();
    };

    // id 3 shouldn't exist
    expect(await isExist(), 'validator2 should not exist').be.false;

    // stake minIndexVotingPower * 2
    const stakeAmount = minIndexVotingPower.muln(2);
    await stakeManager.methods.stake(validator2, deployer).send({ value: stakeAmount.toString() });
    const validatorInfo = await stakeManager.methods.validators(validator2).call();
    expect(validatorInfo.id, 'validator2 id should be 3').be.equal('3');
    expect(await isExist(), 'validator2 should exist').be.true;

    // approve
    const commissionShare = await createCommissionShareContract(validator2);
    await commissionShare.methods.approve(stakeManager.options.address, MAX_INTEGER.toString()).send();

    // unstake minIndexVotingPower
    await stakeManager.methods.startUnstake(validator2, deployer, minIndexVotingPower).send();
    // current amount: minIndexVotingPower
    expect(await isExist(), 'validator2 should still exist').be.true;

    // unstake minUnstakeAmount
    await stakeManager.methods.startUnstake(validator2, deployer, minUnstakeAmount).send();
    // current amount: minIndexVotingPower - minUnstakeAmount
    expect(await isExist(), "validator2 shouldn't exist").be.false;

    // stake minStakeAmount
    await stakeManager.methods.stake(validator2, deployer).send({ value: minStakeAmount.toString() });
    // current amount: minIndexVotingPower - minUnstakeAmount + minStakeAmount
    expect(await isExist(), 'validator2 should exist').be.true;

    // unstake minIndexVotingPower - minUnstakeAmount + minStakeAmount
    await stakeManager.methods.startUnstake(validator2, deployer, minIndexVotingPower.sub(minUnstakeAmount).add(minStakeAmount).toString()).send();
    // current amount: 0
    expect(await isExist(), "validator2 shouldn't exist").be.false;

    // reward
    await stakeManager.methods.afterBlock(validator2, [], []).send({ value: minIndexVotingPower });
    expect(await isExist(), 'validator2 should be added').be.true;

    // slash
    // await stakeManager.methods.slash(validator2, 1).send();
    // expect(await isExist(), 'validator2 should be removed').be.false;
  });

  it('should unstake and claim correctly', async () => {
    const stakeAmount = toBN(100);
    const unstakeAmount = toBN(16);
    const rewardAmount = toBN(97);
    const commissionRate = 33;
    const receiver1BalStart = toBN(await web3.eth.getBalance(receiver1));
    const receiver2BalStart = toBN(await web3.eth.getBalance(receiver2));
    await stakeManager.methods.stake(validator3, deployer).send({ value: stakeAmount.toString() });
    const commissionShare = await createCommissionShareContract(validator3);
    const validatorKeeper = await createValidatorKeeperContract(validator3);
    await stakeManager.methods.setCommissionRate(commissionRate).send({ from: validator3 });
    await commissionShare.methods.approve(stakeManager.options.address, MAX_INTEGER.toString()).send();
    expect(await web3.eth.getBalance(commissionShare.options.address), 'commissionShare balance should be equal').be.equal(stakeAmount.toString());

    await stakeManager.methods.afterBlock(validator3, [], []).send({ value: rewardAmount });
    const commissionAmount = rewardAmount.muln(commissionRate).divn(100);
    const commissionTotalSup = toBN(await commissionShare.methods.totalSupply().call());
    const validatorKeeperAmount = rewardAmount.sub(commissionAmount);
    const claimAmount = toBN(await web3.eth.getBalance(validatorKeeper.options.address));
    expect(claimAmount.eq(validatorKeeperAmount), 'validatorKeeper balance should be equal').be.true;

    const commissionBal = toBN(await web3.eth.getBalance(commissionShare.options.address));
    await stakeManager.methods.startUnstake(validator3, receiver1, unstakeAmount.toString()).send();
    await upTimestamp(unstakeDelay);
    await stakeManager.methods.unstake(5).send();
    const receiver1BalAfter = toBN(await web3.eth.getBalance(receiver1));
    const receiver1Change = receiver1BalAfter.sub(receiver1BalStart);
    const unstakeReward = unstakeAmount.mul(commissionBal).div(commissionTotalSup);
    expect(receiver1Change.eq(unstakeReward), 'receiver1Change should be equal').be.true;

    await stakeManager.methods.startClaim(receiver2, claimAmount).send({ from: validator3 });
    await upTimestamp(unstakeDelay);
    await stakeManager.methods.unstake(6).send();
    const receiver2BalAfter = toBN(await web3.eth.getBalance(receiver2));
    const receiver2Change = receiver2BalAfter.sub(receiver2BalStart);
    expect(receiver2Change.eq(claimAmount), 'receiver2Change should be equal').be.true;

    const totalAmount = rewardAmount.add(stakeAmount);
    const totalCalAmount = receiver2Change.add(receiver1Change).add(toBN(await web3.eth.getBalance(commissionShare.options.address)));
    expect(totalAmount.eq(totalCalAmount), 'totalAmount should be equal').be.true;
  });
});
