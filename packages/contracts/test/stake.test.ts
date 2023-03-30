import crypto from 'crypto';
import { ethers } from 'hardhat';
import { assert, expect } from 'chai';
import { BN, MAX_INTEGER, bufferToHex, toBuffer } from 'ethereumjs-util';
import { Contract, ContractFactory, Signer, BigNumber } from 'ethers';
import { validatorsDecode, validatorsEncode } from '@rei-network/core/src/consensus/reimint/contracts/utils';
import { upTimestamp } from './utils';

type MissRecord = [string, number];

describe('StakeManger', () => {
  let config: Contract;
  let stakeManager: Contract;
  let validatorRewardPool: Contract;
  let prison: Contract;
  let deployer: Signer;
  let receiver1: Signer;
  let receiver2: Signer;
  let genesis1: Signer;
  let genesis2: Signer;
  let validator1: Signer;
  let validator2: Signer;
  let validator3: Signer;
  let validator4: Signer;

  let deployerAddr: string;
  let receiver1Addr: string;
  let receiver2Addr: string;
  let genesis1Addr: string;
  let genesis2Addr: string;
  let validator1Addr: string;
  let validator2Addr: string;
  let validator3Addr: string;
  let validator4Addr: string;

  let unstakeDelay: number;
  let minIndexVotingPower: BigNumber;
  let stakeId = 0;

  let configFactory: ContractFactory;
  let stakeManagerFactory: ContractFactory;
  let validatorRewardPoolFactory: ContractFactory;
  let prisonFactory: ContractFactory;
  let commissionShareFactory: ContractFactory;
  let unstakePoolFactory: ContractFactory;

  async function createCommissionShareContract(validator: string) {
    const v = await stakeManager.validators(validator);
    return commissionShareFactory.connect(deployer).attach(v.commissionShare);
  }

  before(async () => {
    const accounts = await ethers.getSigners();
    deployer = accounts[0];
    validator1 = accounts[1];
    receiver1 = accounts[2];
    receiver2 = accounts[3];
    genesis1 = accounts[4];
    genesis2 = accounts[5];
    validator2 = accounts[6];
    validator3 = accounts[7];
    validator4 = accounts[8];
    deployerAddr = await deployer.getAddress();
    validator1Addr = await validator1.getAddress();
    receiver1Addr = await receiver1.getAddress();
    receiver2Addr = await receiver2.getAddress();
    genesis1Addr = await genesis1.getAddress();
    genesis2Addr = await genesis2.getAddress();
    validator2Addr = await validator2.getAddress();
    validator3Addr = await validator3.getAddress();
    validator4Addr = await validator4.getAddress();

    configFactory = await ethers.getContractFactory('Config_devnet');
    commissionShareFactory = await ethers.getContractFactory('CommissionShare');
    stakeManagerFactory = await ethers.getContractFactory('StakeManager');
    validatorRewardPoolFactory = await ethers.getContractFactory('ValidatorRewardPool');
    unstakePoolFactory = await ethers.getContractFactory('UnstakePool');
    prisonFactory = await ethers.getContractFactory('Prison');
  });

  it('should deploy succeed', async () => {
    config = await configFactory.connect(deployer).deploy();
    await config.setSystemCaller(deployerAddr);
    validatorRewardPool = await validatorRewardPoolFactory.connect(deployer).deploy(config.address);
    await config.setValidatorRewardPool(validatorRewardPool.address);
    let unstakePool = await unstakePoolFactory.connect(deployer).deploy(config.address);
    await config.setUnstakePool(unstakePool.address);
    stakeManager = await stakeManagerFactory.connect(deployer).deploy(config.address, genesis1Addr, [genesis1Addr, genesis2Addr], [100, 100]);
    await config.setStakeManager(stakeManager.address);
    unstakeDelay = (await config.unstakeDelay()).toNumber();
    minIndexVotingPower = await config.minIndexVotingPower();
    prison = await prisonFactory.connect(deployer).deploy(config.address);
    await config.setPrison(prison.address);
  });

  it('should initialize succeed', async () => {
    expect(await stakeManager.indexedValidatorsLength(), 'indexedValidatorsLength should be equal to 0').to.equal('0');
    expect((await stakeManager.validators(genesis1Addr)).id, 'genesis validator id should match').to.equal('0');
    expect((await stakeManager.validators(genesis2Addr)).id, 'genesis validator id should match').to.equal('1');
  });

  it('should stake failed(amount is zero)', async () => {
    let failed = false;
    try {
      await stakeManager.stake(validator1Addr, deployerAddr, { value: 0 });
      failed = true;
    } catch (err) {}
    if (failed) {
      assert('stake should failed');
    }
  });

  it('should stake succeed', async () => {
    // stake stakeAmount
    const stakeAmount = minIndexVotingPower.div(2).toString();
    stakeId++;
    await stakeManager.stake(validator1Addr, deployerAddr, { value: stakeAmount });
    const shares = await (await createCommissionShareContract(validator1Addr)).balanceOf(deployerAddr);
    expect(shares, 'shares should be equal to amount at the time of the first staking').to.equal(stakeAmount);

    // stake minIndexVotingPower - stakeAmount
    stakeId++;
    await stakeManager.stake(validator1Addr, deployerAddr, { value: minIndexVotingPower.sub(stakeAmount) });
    const validatorAddress = await stakeManager.indexedValidatorsById(2);
    expect(validatorAddress, 'address should be equal').be.equal(validator1Addr);
    const validatorAddress2 = await stakeManager.indexedValidatorsByIndex(0);
    expect(validatorAddress2, 'address should be equal').be.equal(validator1Addr);
  });

  it('should get voting power', async () => {
    const votingPower1 = await stakeManager.getVotingPowerByIndex(0);
    expect(votingPower1.toString(), 'votingPower1 should be euqal').be.equal(minIndexVotingPower.toString());
    const votingPower2 = await stakeManager.getVotingPowerById(2);
    expect(votingPower2.toString(), 'votingPower2 should be euqal').be.equal(minIndexVotingPower.toString());
    const votingPower3 = await stakeManager.getVotingPowerByAddress(validator1Addr);
    expect(votingPower3.toString(), 'votingPower3 should be euqal').be.equal(minIndexVotingPower.toString());
  });

  it('should match validator info', async () => {
    const commissionShare = await createCommissionShareContract(validator1Addr);
    expect(await commissionShare.validator(), 'validator address should be equal').to.equal(validator1Addr);
  });

  it('should approve succeed', async () => {
    const commissionShare = await createCommissionShareContract(validator1Addr);
    await commissionShare.approve(stakeManager.address, MAX_INTEGER.toString());
  });

  it('should start unstake succeed', async () => {
    // currently, user amount should be minIndexVotingPower
    const unstakeAmount1 = minIndexVotingPower.div(2);
    const unstakeAmount2 = minIndexVotingPower.div(2);
    const unstakeAmountArray = [unstakeAmount1, unstakeAmount2];

    await stakeManager.startUnstake(validator1Addr, deployerAddr, unstakeAmount1.toString());
    await stakeManager.startUnstake(validator1Addr, deployerAddr, unstakeAmount2.toString());

    await Promise.all(
      unstakeAmountArray.map(async (element, i) => {
        const unstakeInfo = await stakeManager.unstakeQueue(i);
        expect(unstakeInfo.validator, 'validator address should be equal').be.equal(validator1Addr);
        expect(unstakeInfo.to, 'to address should be equal').be.equal(deployerAddr);
        expect(unstakeInfo.unstakeShares.toString(), 'unStakeAmount address should be equal').be.equal(element.toString());
      })
    );

    await upTimestamp(deployerAddr, unstakeDelay);
    await stakeManager.unstake(0);
    await stakeManager.unstake(1);
    // TODO: check amount
  });

  it('should set commission rate correctly', async () => {
    const oldCommissionRate = 0;
    const newCommissionRate = 50;
    const setInterval = await config.setCommissionRateInterval();
    const validatorInfoBefore = await stakeManager.validators(validator1Addr);
    expect(validatorInfoBefore.commissionRate.toString(), 'commissionRate should be 0').be.equal(oldCommissionRate.toString());
    await stakeManager.connect(validator1).setCommissionRate(newCommissionRate);
    const validatorInfoAfter = await stakeManager.validators(validator1Addr);
    expect(validatorInfoAfter.commissionRate.toString(), 'commissionRare should be new commissionRate').be.equal(newCommissionRate.toString());

    await upTimestamp(deployerAddr, setInterval - 3);
    let failed = false;
    try {
      await stakeManager.connect(validator1).setCommissionRate(oldCommissionRate);
      failed = true;
    } catch (err) {}

    if (failed) {
      assert.fail('update commission rate too frequently');
    }

    await upTimestamp(deployerAddr, 3);
    try {
      await stakeManager.connect(validator1).setCommissionRate(newCommissionRate);
      failed = true;
    } catch (err) {}
    if (failed) {
      assert.fail('repeatedly set commission rate');
    }
  });

  it('should estimate correctly', async () => {
    const estimateMinStake = await stakeManager.estimateSharesToAmount(validator1Addr, 1);
    expect(estimateMinStake.toString(), 'mininual stake amount should be equal').equal('1');
    const wantedShares = '97';
    const estimateStake = await stakeManager.estimateSharesToAmount(validator1Addr, wantedShares);
    expect(estimateStake.toString(), 'estimate shares amount should be equal').be.equal(wantedShares);

    stakeId++;
    await stakeManager.stake(validator1Addr, deployerAddr, { value: estimateStake });
    await stakeManager.slash(validator1Addr, 1, bufferToHex(crypto.randomBytes(32)));
    await stakeManager.reward(validator1Addr, { value: 2000 });
    const estimateMinStake1 = await stakeManager.estimateSharesToAmount(validator1Addr, 1);
    expect(estimateMinStake1.toString(), 'mininual stake amount should be equal').be.equal('11');

    await stakeManager.startUnstake(validator1Addr, deployerAddr, wantedShares);
    const estimateAmount = await stakeManager.estimateUnstakeAmount(validator1Addr, wantedShares);
    expect(estimateAmount.toString(), 'estimateAmount should be equal').be.equal('97');
    await stakeManager.slash(validator1Addr, 0, bufferToHex(crypto.randomBytes(32)));
    const estimateAmount1 = await stakeManager.estimateUnstakeAmount(validator1Addr, wantedShares);
    expect(estimateAmount1.toString(), 'estimateAmount should be equal').be.equal('58');

    await stakeManager.slash(validator1Addr, 1, bufferToHex(crypto.randomBytes(32)));
    const wantedAmount = '97';
    stakeId++;
    await stakeManager.stake(validator1Addr, deployerAddr, { value: wantedAmount });
    await stakeManager.slash(validator1Addr, 1, bufferToHex(crypto.randomBytes(32)));
    await stakeManager.reward(validator1Addr, { value: 1000 });
    const estimateUnstakeShare = await stakeManager.estimateAmountToShares(validator1Addr, 1);
    expect(estimateUnstakeShare.toString(), 'estimateUnstakeShare should be equal').be.equal('1');
  });

  it('should remove and add indexed validator correctly', async () => {
    const isExist = (): Promise<boolean> => {
      return stakeManager.indexedValidatorsExists(3);
    };

    // id 3 shouldn't exist
    expect(await isExist(), 'validator2 should not exist').be.false;

    // stake minIndexVotingPower * 2
    const stakeAmount = minIndexVotingPower.mul(2);
    stakeId++;
    await stakeManager.stake(validator2Addr, deployerAddr, { value: stakeAmount.toString() });
    const validatorInfo = await stakeManager.validators(validator2Addr);
    expect(validatorInfo.id, 'validator2 id should be 3').be.equal('3');
    expect(await isExist(), 'validator2 should exist').be.true;

    // approve
    const commissionShare = await createCommissionShareContract(validator2Addr);
    await commissionShare.approve(stakeManager.address, MAX_INTEGER.toString());

    // unstake minIndexVotingPower
    await stakeManager.startUnstake(validator2Addr, deployerAddr, minIndexVotingPower);
    // current amount: minIndexVotingPower
    expect(await isExist(), 'validator2 should still exist').be.true;

    // unstake 1
    await stakeManager.startUnstake(validator2Addr, deployerAddr, 1);
    // current amount: minIndexVotingPower - 1
    expect(await isExist(), "validator2 shouldn't exist").be.false;

    // stake 1
    stakeId++;
    await stakeManager.stake(validator2Addr, deployerAddr, { value: 1 });
    // current amount: minIndexVotingPower
    expect(await isExist(), 'validator2 should exist').be.true;

    // unstake minIndexVotingPower
    await stakeManager.startUnstake(validator2Addr, deployerAddr, minIndexVotingPower);
    // current amount: 0
    expect(await isExist(), "validator2 shouldn't exist").be.false;

    // reward
    await stakeManager.reward(validator2Addr, { value: minIndexVotingPower });
    expect(await isExist(), 'validator2 should be added').be.true;

    // init evidence hash
    const hash1 = bufferToHex(crypto.randomBytes(32));
    await stakeManager.initEvidenceHash([hash1]);
    expect(await stakeManager.usedEvidence(hash1)).be.true;
    try {
      await stakeManager.slash(validator2Addr, 1, hash1).send();
      assert.fail('should slash failed when hash exists');
    } catch (err) {}

    // slash
    const hash2 = bufferToHex(crypto.randomBytes(32));
    await stakeManager.slash(validator2Addr, 1, hash2);
    expect(await isExist(), 'validator2 should be removed').be.false;
    expect(await stakeManager.usedEvidence(hash2)).be.true;
    try {
      await stakeManager.slash(validator2Addr, 1, hash2);
      assert.fail('should slash failed when hash exists');
    } catch (err) {}
  });

  it('should unstake and claim correctly', async () => {
    const stakeAmount = BigNumber.from(100);
    const unstakeAmount = BigNumber.from(16);
    const rewardAmount = BigNumber.from(97);
    const commissionRate = 33;
    const receiver1BalStart = await ethers.provider.getBalance(receiver1Addr);
    const receiver2BalStart = await ethers.provider.getBalance(receiver2Addr);
    const id1 = stakeId++;
    await stakeManager.stake(validator3Addr, deployerAddr, { value: stakeAmount });
    const commissionShare = await createCommissionShareContract(validator3Addr);
    await stakeManager.connect(validator3).setCommissionRate(commissionRate);
    await commissionShare.approve(stakeManager.address, MAX_INTEGER.toString());

    expect((await ethers.provider.getBalance(commissionShare.address)).toString(), 'commissionShare balance should be equal').be.equal(stakeAmount.toString());

    await stakeManager.reward(validator3Addr, { value: rewardAmount });
    const commissionAmount = rewardAmount.mul(commissionRate).div(100);
    const commissionTotalSup = await commissionShare.totalSupply();
    const validatorKeeperAmount = rewardAmount.sub(commissionAmount);
    const claimAmount = await validatorRewardPool.balanceOf(validator3Addr);
    expect(claimAmount.eq(validatorKeeperAmount), 'validatorKeeper balance should be equal').be.true;

    const commissionBal = await ethers.provider.getBalance(commissionShare.address);
    await stakeManager.startUnstake(validator3Addr, receiver1Addr, unstakeAmount.toString());
    await upTimestamp(deployerAddr, unstakeDelay);
    await stakeManager.unstake(id1);
    const receiver1BalAfter = await ethers.provider.getBalance(receiver1Addr);
    const receiver1Change = receiver1BalAfter.sub(receiver1BalStart);
    const unstakeReward = unstakeAmount.mul(commissionBal).div(commissionTotalSup);
    expect(receiver1Change.eq(unstakeReward), 'receiver1Change should be equal').be.true;

    const id2 = stakeId++;
    await stakeManager.connect(validator3).startClaim(receiver2Addr, claimAmount);
    await upTimestamp(deployerAddr, unstakeDelay);
    await stakeManager.unstake(id2);
    const receiver2BalAfter = await ethers.provider.getBalance(receiver2Addr);
    const receiver2Change = receiver2BalAfter.sub(receiver2BalStart);
    expect(receiver2Change.eq(claimAmount), 'receiver2Change should be equal').be.true;

    const totalAmount = rewardAmount.add(stakeAmount);
    const totalCalAmount = receiver2Change.add(receiver1Change).add(await ethers.provider.getBalance(commissionShare.address));
    expect(totalAmount.eq(totalCalAmount), 'totalAmount should be equal').be.true;
  });

  it('should correctly set active validators', async () => {
    let proposer = '0xb7e390864a90b7b923c9f9310c6f98aafe43f707';
    let vs = [1, 2, 3].map((item) => new BN(item));
    let ps = ['-1', '1', '-100'].map((item) => new BN(item));
    await stakeManager.onAfterBlock(proposer, validatorsEncode(vs, ps));
    expect((await stakeManager.proposer()).toLocaleLowerCase(), 'proposer should be equal').be.equal(proposer);
    let validatorInfos = await stakeManager.getActiveValidatorInfos();
    let { ids, priorities } = validatorsDecode(toBuffer(validatorInfos));
    expect(ids.length, 'length should be equal').be.equal(3);
    expect(priorities.length, 'length should be equal').be.equal(3);
    for (let i = 0; i < 3; i++) {
      assert(ids[i].eq(vs[i]), 'validator address should be equal');
      assert(priorities[i].eq(ps[i]), 'validator priority should be equal');
    }
    proposer = '0xb7e390864a90b7b923c9f9310c6f98aafe43f708';
    vs = [3, 2].map((item) => new BN(item));
    ps = ['-1', '1'].map((item) => new BN(item));
    await stakeManager.onAfterBlock(proposer, validatorsEncode(vs, ps));
    validatorInfos = await stakeManager.getActiveValidatorInfos();
    ({ ids, priorities } = validatorsDecode(toBuffer(validatorInfos)));
    expect((await stakeManager.proposer()).toLocaleLowerCase(), 'proposer should be equal').be.equal(proposer);
    expect(ids.length, 'length should be equal').be.equal(2);
    expect(priorities.length, 'length should be equal').be.equal(2);
    for (let i = 0; i < 2; i++) {
      assert(ids[i].eq(vs[i]), 'validator address should be equal');
      assert(priorities[i].eq(ps[i]), 'validator priority should be equal');
    }
  });

  it('should add missrecord and jail validator correctly', async () => {
    const totalLockedAmountBefore = await stakeManager.totalLockedAmount();
    const votingPower = await stakeManager.getVotingPowerByAddress(validator4Addr);
    await stakeManager.stake(validator4Addr, deployerAddr, { value: minIndexVotingPower });
    const v = await stakeManager.validators(validator4Addr);
    expect(await stakeManager.indexedValidatorsExists(v.id), 'validator should in indexedValidators').to.equal(true);
    const jailThreshold = await config.jailThreshold();
    const missedRecord: MissRecord[] = [[validator4Addr, jailThreshold]];
    await stakeManager.addMissRecord(missedRecord);
    const minerState = await prison.miners(validator4Addr);
    expect(minerState.jailed, 'validator should be jailed').be.equal(true);
    expect(await stakeManager.indexedValidatorsExists(v.id), 'validator should not in indexedValidators').to.equal(false);
    const totalCalAmountAfter = await stakeManager.totalLockedAmount();
    expect(totalCalAmountAfter.toString(), 'totalCalAmount should be equal').be.equal((Number(totalLockedAmountBefore) - Number(votingPower)).toString());
  });

  it('should not index jailed validator ', async () => {
    const totalLockedAmount = await stakeManager.totalLockedAmount();
    const v = await stakeManager.validators(validator4Addr);
    expect(await stakeManager.indexedValidatorsExists(v.id), 'validator should not in indexedValidators').to.equal(false);

    await stakeManager.stake(validator4Addr, deployerAddr, { value: minIndexVotingPower.mul(10) });
    expect(await stakeManager.totalLockedAmount(), 'totalLockedAmount should be equal').be.equal(totalLockedAmount);
    expect(await stakeManager.indexedValidatorsExists(v.id), 'validator should not in indexedValidators').to.equal(false);

    await stakeManager.reward(validator4Addr, { value: minIndexVotingPower.mul(100) });
    expect(await stakeManager.indexedValidatorsExists(v.id), 'validator should not in indexedValidators').to.equal(false);
    expect(await stakeManager.totalLockedAmount(), 'totalLockedAmount should be equal').be.equal(totalLockedAmount);

    let failed = false;
    try {
      await stakeManager.addIndexedValidator(v.id);
      failed = true;
    } catch (e) {}
    if (failed) {
      assert.fail('should not be able to add indexed validator');
    }
  });

  it('totalLockedAmount should not change when validator is jailed', async () => {
    const totalLockedAmount = await stakeManager.totalLockedAmount();
    await stakeManager.slash(validator4Addr, 0, bufferToHex(crypto.randomBytes(32)));
    expect(await stakeManager.totalLockedAmount(), 'totalLockedAmount should be equal').be.equal(totalLockedAmount);
    const commissionShare = await createCommissionShareContract(validator4Addr);
    await commissionShare.approve(stakeManager.address, MAX_INTEGER.toString());
    await stakeManager.startUnstake(validator4Addr, deployerAddr, 1);
    expect(await stakeManager.totalLockedAmount(), 'totalLockedAmount should be equal').be.equal(totalLockedAmount);
    const claimAmount = await validatorRewardPool.balanceOf(validator4Addr);
    await stakeManager.connect(validator4).startClaim(receiver2Addr, claimAmount);
    expect(await stakeManager.totalLockedAmount(), 'totalLockedAmount should be equal').be.equal(totalLockedAmount);
  });

  it('should unjail validator correctly', async () => {
    const forfeit = await config.forfeit();
    const totalLockedAmountBefore = await stakeManager.totalLockedAmount();
    const votingPower = await stakeManager.getVotingPowerByAddress(validator4Addr);
    await stakeManager.connect(validator4).unjail({ value: forfeit });
    const totalLockedAmountAfter = await stakeManager.totalLockedAmount();
    expect(totalLockedAmountAfter.toString(), 'totalLockedAmount should be equal').be.equal((Number(totalLockedAmountBefore) + Number(votingPower)).toString());
    const v = await stakeManager.validators(validator4Addr);
    expect(await stakeManager.indexedValidatorsExists(v.id), 'validator should in indexedValidators').to.equal(true);
    const minerState = await prison.miners(validator4Addr);
    expect(minerState.jailed, 'validator should not be jailed').be.equal(false);
  });
});
