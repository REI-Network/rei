import type { Artifacts } from 'hardhat/types';
import type Web3 from 'web3';
import { assert, expect } from 'chai';
import { BN, MAX_INTEGER } from 'ethereumjs-util';

declare var artifacts: Artifacts;
declare var web3: Web3;

const Config = artifacts.require('Config');
const CommissionShare = artifacts.require('CommissionShare');
const UnstakeKeeper = artifacts.require('UnstakeKeeper');
const StakeManager = artifacts.require('StakeManager');
const ValidatorKeeper = artifacts.require('ValidatorKeeper');

describe('StakeManger', () => {
  let config: any;
  let stakeManager: any;
  let deployer: string;
  let validator1: string;
  let receiver1: string;
  let receiver2: string;
  let genesis1: string;
  let genesis2: string;
  let validator2: string;
  let validator3: string;
  let unstakeDelay: number;

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

  async function upTimestamp(waittime: number, address: string) {
    // wait some time and send a transaction to update blockchain timestamp
    await new Promise((r) => setTimeout(r, waittime * 1000 + 10));
    await web3.eth.sendTransaction({
      from: address,
      to: address,
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
    await config.methods.setStakeManager(stakeManager.options.address).send();
    unstakeDelay = toBN(await config.methods.unstakeDelay().call()).toNumber();
  });

  it('should initialize succeed', async () => {
    expect(await stakeManager.methods.firstUnstakeId().call(), 'firstUnstakeId should be equal to 0').to.equal('0');
    expect(await stakeManager.methods.lastUnstakeId().call(), 'lastUnstakeId should be equal to 0').to.equal('0');
    expect(await stakeManager.methods.indexedValidatorsLength().call(), 'indexedValidatorsLength should be equal to 0').to.equal('0');
    expect((await stakeManager.methods.validators(genesis1).call()).id, 'genesis validator id should match').to.equal('0');
    expect((await stakeManager.methods.validators(genesis2).call()).id, 'genesis validator id should match').to.equal('1');
  });

  it('should stake failed(min stake amount)', async () => {
    const minStakeAmount = toBN(await config.methods.minStakeAmount().call());
    try {
      await stakeManager.methods.stake(validator1, deployer).send({ value: minStakeAmount.subn(1).toString() });
      assert.fail("shouldn't stake succeed");
    } catch (err) {}
  });

  it('should stake succeed', async () => {
    const minStakeAmount = toBN(await config.methods.minStakeAmount().call());
    await stakeManager.methods.stake(validator1, deployer).send({ value: minStakeAmount.toString() });
    const shares = await (await createCommissionShareContract(validator1)).methods.balanceOf(deployer).call();
    expect(shares, 'shares should be equal to amount at the time of the first staking').to.equal(minStakeAmount.toString());
    const validatorAddress = await stakeManager.methods.indexedValidatorsById(2).call();
    expect(validatorAddress, 'address should be equal').be.equal(validator1);
    const validatorAddress2 = await stakeManager.methods.indexedValidatorsByIndex(0).call();
    expect(validatorAddress2, 'address should be equal').be.equal(validator1);
  });

  it('should get voting power', async () => {
    const votingPower1 = await stakeManager.methods.getVotingPowerByIndex(0).call();
    expect(votingPower1, 'votingPower1 should be euqal').be.equal('10');
    const votingPower2 = await stakeManager.methods.getVotingPowerById(2).call();
    expect(votingPower2, 'votingPower2 should be euqal').be.equal('10');
    const votingPower3 = await stakeManager.methods.getVotingPowerByAddress(validator1).call();
    expect(votingPower3, 'votingPower3 should be euqal').be.equal('10');
  });

  it('should match validator info', async () => {
    const commissionShare = await createCommissionShareContract(validator1);
    expect(await commissionShare.methods.validator().call(), 'validator address should be equal').to.equal(validator1);
    const unstakeKeeper = await createUnstakeKeeperContract(validator1);
    expect(await unstakeKeeper.methods.validator().call(), 'validator address should be equal').to.equal(validator1);
  });

  it('should approve succeed', async () => {
    const commissionShare = await createCommissionShareContract(validator1);
    await commissionShare.methods.approve(stakeManager.options.address, MAX_INTEGER.toString()).send();
  });

  it('should get first and last id', async () => {
    const stakeAmount = toBN(100);
    const unstakeAmount = toBN(110);
    const firstId = await stakeManager.methods.firstUnstakeId().call();
    const lastId = await stakeManager.methods.lastUnstakeId().call();
    expect(firstId, 'first id should be equal').equal('0');
    expect(lastId, 'last id should be equal').equal('0');
    await stakeManager.methods.stake(validator1, deployer).send({ value: stakeAmount });
    await stakeManager.methods.stake(validator1, deployer).send({ value: stakeAmount });
    await stakeManager.methods.startUnstake(validator1, deployer, stakeAmount.toString()).send();
    await stakeManager.methods.startUnstake(validator1, deployer, unstakeAmount.toString()).send();
    const firstId1 = await stakeManager.methods.firstUnstakeId().call();
    const lastId1 = await stakeManager.methods.lastUnstakeId().call();
    expect(firstId1, 'first id should be equal').equal('0');
    expect(lastId1, 'last id should be equal').equal('2');
    const unstakeInfo = await stakeManager.methods.unstakeQueue(1).call();
    expect(unstakeInfo.validator, 'validator address should be equal').be.equal(validator1);
    expect(unstakeInfo.to, 'to address should be equal').be.equal(deployer);
    expect(unstakeInfo.unstakeShares, 'unStakeAmount address should be equal').be.equal(unstakeAmount.toString());
    await stakeManager.methods.doUnstake().send();
    await upTimestamp(unstakeDelay, deployer);
    const firstId2 = await stakeManager.methods.firstUnstakeId().call();
    const lastId2 = await stakeManager.methods.lastUnstakeId().call();
    expect(firstId2, 'first id should be equal').equal('2');
    expect(lastId2, 'last id should be equal').equal('2');
  });

  it('should set commission rate correctly', async () => {
    const validatorInfoBefore = await stakeManager.methods.validators(validator1).call();
    expect(validatorInfoBefore.commissionRate, 'commissionRate should be 0').be.equal('0');
    const commissionRate = 50;
    await stakeManager.methods.setCommissionRate(commissionRate).send({ from: validator1 });
    const validatorInfoAfter = await stakeManager.methods.validators(validator1).call();
    expect(validatorInfoAfter.commissionRate, 'commissionShare should be 0').be.equal(commissionRate.toString());
    try {
      await stakeManager.methods.setCommissionRate(commissionRate).send({ from: validator1 });
    } catch (err) {
      expect(err.message, 'error message should be equal').be.equal("VM Exception while processing transaction: reverted with reason string 'StakeManager: update commission rate too frequently'");
    }
  });

  it('should estimate correctly', async () => {
    const minStakeAmount = toBN(await config.methods.minStakeAmount().call());
    const estimateMinStake = await stakeManager.methods.estimateMinStakeAmount(validator1).call();
    expect(estimateMinStake, 'mininual stake amount should be equal').equal(minStakeAmount.toString());
    const wantedShares = toBN('97');
    const estimateStake = await stakeManager.methods.estimateStakeAmount(validator1, wantedShares).call();
    expect(estimateStake, 'estimate shares amount should be equal').be.equal(wantedShares.toString());
    await stakeManager.methods.stake(validator1, deployer).send({ value: estimateStake });
    await stakeManager.methods.slash(validator1, 1).send();

    await stakeManager.methods.reward(validator1).send({ value: 2000 });
    const estimateMinStake1 = await stakeManager.methods.estimateMinStakeAmount(validator1).call();
    expect(estimateMinStake1, 'mininual stake amount should be equal').be.equal('11');
    const estimateStake1 = await stakeManager.methods.estimateStakeAmount(validator1, '1').call();
    expect(estimateStake1, 'estimate stake amount should be equal').be.equal(estimateStake1);

    await stakeManager.methods.startUnstake(validator1, deployer, wantedShares.toString()).send();
    const estimateAmount = await stakeManager.methods.estimateUnstakeAmount(validator1, wantedShares).call();
    expect(estimateAmount, 'estimateAmount should be equal').be.equal('97');
    await stakeManager.methods.slash(validator1, 0).send();
    const estimateAmount1 = await stakeManager.methods.estimateUnstakeAmount(validator1, wantedShares).call();
    expect(estimateAmount1, 'estimateAmount should be equal').be.equal('58');

    await stakeManager.methods.slash(validator1, 1).send();
    const wantedAmount = toBN(97);
    await stakeManager.methods.stake(validator1, deployer).send({ value: wantedAmount.toString() });
    await stakeManager.methods.slash(validator1, 1).send();
    await stakeManager.methods.reward(validator1).send({ value: 1000 });
    const estimateUnstakeShare = await stakeManager.methods.estimateMinUnstakeShares(validator1).call();
    expect(estimateUnstakeShare, 'estimateUnstakeShare should be equal').be.equal('1');
    const estimateUnstakeShare1 = await stakeManager.methods.estimateUnstakeShares(validator1, 5).call();
    expect(estimateUnstakeShare1, 'estimateUnstakeShare1 should be equal').be.equal('1');
  });

  it('should remove and add indexed validator correctly', async () => {
    const validatorsLength = await stakeManager.methods.indexedValidatorsLength().call();
    expect(validatorsLength, 'validators length should be equal').be.equal('1');

    const stakeAmount = toBN('100');
    await stakeManager.methods.stake(validator2, deployer).send({ value: stakeAmount.toString() });
    const validatorInfo = await stakeManager.methods.validators(validator2).call();
    const validatorAddress = await stakeManager.methods.indexedValidatorsById(validatorInfo.id).call();
    const validatorsLength1 = await stakeManager.methods.indexedValidatorsLength().call();
    expect(validatorsLength1, 'validators length should be added').be.equal('2');
    expect(validatorAddress, 'address should be equal').be.equal(validator2);

    const commissionShare = await createCommissionShareContract(validator2);
    await commissionShare.methods.approve(stakeManager.options.address, MAX_INTEGER.toString()).send();
    await stakeManager.methods.startUnstake(validator2, deployer, stakeAmount.toString()).send();
    await stakeManager.methods.doUnstake().send();
    await upTimestamp(unstakeDelay, deployer);
    const validatorsLength2 = await stakeManager.methods.indexedValidatorsLength().call();
    expect(validatorsLength2, 'validators length should be discreased').be.equal('1');

    await stakeManager.methods.reward(validator2).send({ value: toBN(1000) });
    await stakeManager.methods.addIndexedValidator(validator2).send();
    const validatorsLength3 = await stakeManager.methods.indexedValidatorsLength().call();
    expect(validatorsLength3, 'validators length should be added').be.equal('2');

    await stakeManager.methods.slash(validator2, 1).send();
    await stakeManager.methods.removeIndexedValidator(validator2).send();
    const validatorsLength4 = await stakeManager.methods.indexedValidatorsLength().call();
    expect(validatorsLength4, 'validators length should be discreased').be.equal('1');
  });

  it('should unstake and claim correctky', async () => {
    const stakeAmount = toBN(100);
    const stakeHalfAmount = toBN(50);
    const rewardAmount = toBN(97);
    const receiver1BlaBefore = toBN(await web3.eth.getBalance(receiver1));
    const receiver2BlaBefore = toBN(await web3.eth.getBalance(receiver2));
    await stakeManager.methods.stake(validator3, deployer).send({ value: stakeAmount.toString() });
    const commissionShare = await createCommissionShareContract(validator3);
    const validatorKeeper = await createValidatorKeeperContract(validator3);
    const commissionRate = 33;
    await stakeManager.methods.setCommissionRate(commissionRate).send({ from: validator3 });
    await commissionShare.methods.approve(stakeManager.options.address, MAX_INTEGER.toString()).send();

    await stakeManager.methods.reward(validator3).send({ value: rewardAmount });
    const commisonAmount = rewardAmount.muln(commissionRate).divn(100);
    const claimAmount = toBN(await web3.eth.getBalance(validatorKeeper.options.address));
    await stakeManager.methods.startUnstake(validator3, receiver1, stakeHalfAmount.toString()).send();
    await stakeManager.methods.startClaim(receiver2, claimAmount).send({ from: validator3 });
    await upTimestamp(unstakeDelay, deployer);
    await stakeManager.methods.doUnstake().send();

    const receiver1BlaAfter = toBN(await web3.eth.getBalance(receiver1));
    const receiver2BlaAfter = toBN(await web3.eth.getBalance(receiver2));
    const shrAfterUnstake = toBN(await commissionShare.methods.balanceOf(deployer).call());
    const receiver1Change = receiver1BlaAfter.sub(receiver1BlaBefore);
    const receiver2Change = receiver2BlaAfter.sub(receiver2BlaBefore);
    expect(receiver1Change.eq(stakeHalfAmount.add(commisonAmount.divn(2))), 'unstake amount should be equal').be.true;
    expect(receiver2Change.eq(claimAmount), 'validator reward amount should be equal').be.true;
    expect(shrAfterUnstake.eq(stakeAmount.sub(stakeHalfAmount)), 'shares should be equal').be.true;
    const commistionBlance = await web3.eth.getBalance(commissionShare.options.address);
    expect(commistionBlance, 'commistion blance should be equal').be.equal(stakeAmount.sub(stakeHalfAmount).add(commisonAmount.divn(2)).toString());
    const rewardTotal = receiver1Change.add(receiver2Change).add(commisonAmount.divn(2)).sub(stakeHalfAmount);
    expect(rewardTotal.eq(rewardAmount), 'reward amount should be equal').be.true;
    const validatorKeeperBla = toBN(await web3.eth.getBalance(validatorKeeper.options.address));
    expect(validatorKeeperBla.eqn(0), 'validatorKeeper balance should be 0').be.true;
  });
});
