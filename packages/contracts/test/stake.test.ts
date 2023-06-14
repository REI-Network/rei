import crypto from 'crypto';
import { ethers } from 'hardhat';
import { assert, expect } from 'chai';
import { BN, MAX_INTEGER, bufferToHex, toBuffer } from 'ethereumjs-util';
import { Contract, ContractFactory, Signer, BigNumber } from 'ethers';
import { validatorsDecode, validatorsEncode } from '@rei-network/core/dist/reimint/contracts/utils';
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
  let validator5: Signer;
  let validator6: Signer;
  let validator7: Signer;
  let validator8: Signer;
  let validator9: Signer;

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
    validator5 = accounts[9];
    validator6 = accounts[10];
    validator7 = accounts[11];
    validator8 = accounts[12];
    validator9 = accounts[13];

    configFactory = await ethers.getContractFactory('Config_devnet');
    commissionShareFactory = await ethers.getContractFactory('CommissionShare');
    stakeManagerFactory = await ethers.getContractFactory('StakeManager');
    validatorRewardPoolFactory = await ethers.getContractFactory('ValidatorRewardPool');
    unstakePoolFactory = await ethers.getContractFactory('UnstakePool');
    prisonFactory = await ethers.getContractFactory('Prison');
  });

  it('should deploy succeed', async () => {
    config = await configFactory.connect(deployer).deploy();
    await config.setSystemCaller(await deployer.getAddress());
    validatorRewardPool = await validatorRewardPoolFactory.connect(deployer).deploy(config.address);
    await config.setValidatorRewardPool(validatorRewardPool.address);
    let unstakePool = await unstakePoolFactory.connect(deployer).deploy(config.address);
    await config.setUnstakePool(unstakePool.address);
    stakeManager = await stakeManagerFactory.connect(deployer).deploy(config.address, await genesis1.getAddress(), [await genesis1.getAddress(), await genesis2.getAddress()], [100, 100]);
    await config.setStakeManager(stakeManager.address);
    unstakeDelay = (await config.unstakeDelay()).toNumber();
    minIndexVotingPower = await config.minIndexVotingPower();
    prison = await prisonFactory.connect(deployer).deploy(config.address);
    await config.setPrison(prison.address);
  });

  it('should initialize succeed', async () => {
    expect(await stakeManager.indexedValidatorsLength(), 'indexedValidatorsLength should be equal to 0').to.equal('0');
    expect((await stakeManager.validators(await genesis1.getAddress())).id, 'genesis validator id should match').to.equal('0');
    expect((await stakeManager.validators(await genesis2.getAddress())).id, 'genesis validator id should match').to.equal('1');
  });

  it('should stake failed(amount is zero)', async () => {
    let failed = false;
    try {
      await stakeManager.stake(await validator1.getAddress(), await deployer.getAddress(), { value: 0 });
      failed = true;
    } catch (err) {}
    if (failed) {
      assert('stake should failed');
    }
  });

  it('should stake succeed', async () => {
    const validator = await validator1.getAddress();
    const deployerAddr = await deployer.getAddress();
    // stake stakeAmount
    const stakeAmount = minIndexVotingPower.div(2).toString();
    stakeId++;
    await stakeManager.stake(validator, deployerAddr, { value: stakeAmount });
    const shares = await (await createCommissionShareContract(validator)).balanceOf(deployerAddr);
    expect(shares, 'shares should be equal to amount at the time of the first staking').to.equal(stakeAmount);

    // stake minIndexVotingPower - stakeAmount
    stakeId++;
    await stakeManager.stake(validator, deployerAddr, { value: minIndexVotingPower.sub(stakeAmount) });
    const validatorAddress = await stakeManager.indexedValidatorsById(2);
    expect(validatorAddress, 'address should be equal').be.equal(validator);
    const validatorAddress2 = await stakeManager.indexedValidatorsByIndex(0);
    expect(validatorAddress2, 'address should be equal').be.equal(validator);
  });

  it('should get voting power', async () => {
    const votingPower1 = await stakeManager.getVotingPowerByIndex(0);
    expect(votingPower1.toString(), 'votingPower1 should be euqal').be.equal(minIndexVotingPower.toString());
    const votingPower2 = await stakeManager.getVotingPowerById(2);
    expect(votingPower2.toString(), 'votingPower2 should be euqal').be.equal(minIndexVotingPower.toString());
    const votingPower3 = await stakeManager.getVotingPowerByAddress(await validator1.getAddress());
    expect(votingPower3.toString(), 'votingPower3 should be euqal').be.equal(minIndexVotingPower.toString());
  });

  it('should match validator info', async () => {
    const commissionShare = await createCommissionShareContract(await validator1.getAddress());
    expect(await commissionShare.validator(), 'validator address should be equal').to.equal(await validator1.getAddress());
  });

  it('should approve succeed', async () => {
    const commissionShare = await createCommissionShareContract(await validator1.getAddress());
    await commissionShare.approve(stakeManager.address, MAX_INTEGER.toString());
  });

  it('should start unstake succeed', async () => {
    const deployerAddr = await deployer.getAddress();
    const validatorAddr = await validator1.getAddress();
    // currently, user amount should be minIndexVotingPower
    const unstakeAmount1 = minIndexVotingPower.div(2);
    const unstakeAmount2 = minIndexVotingPower.div(2);
    const unstakeAmountArray = [unstakeAmount1, unstakeAmount2];

    await stakeManager.startUnstake(validatorAddr, deployerAddr, unstakeAmount1.toString());
    await stakeManager.startUnstake(validatorAddr, deployerAddr, unstakeAmount2.toString());

    await Promise.all(
      unstakeAmountArray.map(async (element, i) => {
        const unstakeInfo = await stakeManager.unstakeQueue(i);
        expect(unstakeInfo.validator, 'validator address should be equal').be.equal(validatorAddr);
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
    const deployerAddr = await deployer.getAddress();
    const validatorAddr = await validator1.getAddress();
    const setInterval = await config.setCommissionRateInterval();
    const validatorInfoBefore = await stakeManager.validators(validatorAddr);
    expect(validatorInfoBefore.commissionRate.toString(), 'commissionRate should be 0').be.equal(oldCommissionRate.toString());
    await stakeManager.connect(validator1).setCommissionRate(newCommissionRate);
    const validatorInfoAfter = await stakeManager.validators(validatorAddr);
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
    const deployerAddr = await deployer.getAddress();
    const validatorAddr = await validator1.getAddress();
    const estimateMinStake = await stakeManager.estimateSharesToAmount(validatorAddr, 1);
    expect(estimateMinStake.toString(), 'mininual stake amount should be equal').equal('1');
    const wantedShares = '97';
    const estimateStake = await stakeManager.estimateSharesToAmount(validatorAddr, wantedShares);
    expect(estimateStake.toString(), 'estimate shares amount should be equal').be.equal(wantedShares);

    stakeId++;
    await stakeManager.stake(validatorAddr, deployerAddr, { value: estimateStake });
    await stakeManager.freeze(validatorAddr, bufferToHex(crypto.randomBytes(32)));
    await stakeManager.unfreeze(validatorAddr, 100);
    await stakeManager.reward(validatorAddr, { value: 2000 });
    const estimateMinStake1 = await stakeManager.estimateSharesToAmount(validatorAddr, 1);
    expect(estimateMinStake1.toString(), 'mininual stake amount should be equal').be.equal('11');

    await stakeManager.startUnstake(validatorAddr, deployerAddr, wantedShares);
    const estimateAmount = await stakeManager.estimateUnstakeAmount(validatorAddr, wantedShares);
    expect(estimateAmount.toString(), 'estimateAmount should be equal').be.equal('97');
    await stakeManager.freeze(validatorAddr, bufferToHex(crypto.randomBytes(32)));
    await stakeManager.unfreeze(validatorAddr, 40);
    const estimateAmount1 = await stakeManager.estimateUnstakeAmount(validatorAddr, wantedShares);
    expect(estimateAmount1.toString(), 'estimateAmount should be equal').be.equal('58');

    await stakeManager.freeze(validatorAddr, bufferToHex(crypto.randomBytes(32)));
    await stakeManager.unfreeze(validatorAddr, 100);
    const wantedAmount = '97';
    stakeId++;
    await stakeManager.stake(validatorAddr, deployerAddr, { value: wantedAmount });
    await stakeManager.freeze(validatorAddr, bufferToHex(crypto.randomBytes(32)));
    await stakeManager.unfreeze(validatorAddr, 100);
    await stakeManager.reward(validatorAddr, { value: 1000 });
    const estimateUnstakeShare = await stakeManager.estimateAmountToShares(validatorAddr, 1);
    expect(estimateUnstakeShare.toString(), 'estimateUnstakeShare should be equal').be.equal('1');
  });

  it('should remove and add indexed validator correctly', async () => {
    const deployerAddr = await deployer.getAddress();
    const validatorAddr = await validator2.getAddress();
    const isExist = (): Promise<boolean> => {
      return stakeManager.indexedValidatorsExists(3);
    };

    // id 3 shouldn't exist
    expect(await isExist(), 'validator2 should not exist').be.false;

    // stake minIndexVotingPower * 2
    const stakeAmount = minIndexVotingPower.mul(2);
    stakeId++;
    await stakeManager.stake(validatorAddr, deployerAddr, { value: stakeAmount.toString() });
    const validatorInfo = await stakeManager.validators(validatorAddr);
    expect(validatorInfo.id, 'validator2 id should be 3').be.equal('3');
    expect(await isExist(), 'validator2 should exist').be.true;

    // approve
    const commissionShare = await createCommissionShareContract(validatorAddr);
    await commissionShare.approve(stakeManager.address, MAX_INTEGER.toString());

    // unstake minIndexVotingPower
    await stakeManager.startUnstake(validatorAddr, deployerAddr, minIndexVotingPower);
    // current amount: minIndexVotingPower
    expect(await isExist(), 'validator2 should still exist').be.true;

    // unstake 1
    await stakeManager.startUnstake(validatorAddr, deployerAddr, 1);
    // current amount: minIndexVotingPower - 1
    expect(await isExist(), "validator2 shouldn't exist").be.false;

    // stake 1
    stakeId++;
    await stakeManager.stake(validatorAddr, deployerAddr, { value: 1 });
    // current amount: minIndexVotingPower
    expect(await isExist(), 'validator2 should exist').be.true;

    // unstake minIndexVotingPower
    await stakeManager.startUnstake(validatorAddr, deployerAddr, minIndexVotingPower);
    // current amount: 0
    expect(await isExist(), "validator2 shouldn't exist").be.false;

    // reward
    await stakeManager.reward(validatorAddr, { value: minIndexVotingPower });
    expect(await isExist(), 'validator2 should be added').be.true;

    // init evidence hash
    const hash1 = bufferToHex(crypto.randomBytes(32));
    await stakeManager.initEvidenceHash([hash1]);
    expect(await stakeManager.usedEvidence(hash1)).be.true;
    try {
      await stakeManager.slash(validatorAddr, 1, hash1).send();
      assert.fail('should slash failed when hash exists');
    } catch (err) {}

    // slash
    const hash2 = bufferToHex(crypto.randomBytes(32));
    await stakeManager.freeze(validatorAddr, hash2);
    await stakeManager.connect(deployer).unfreeze(validatorAddr, 100);
    expect(await isExist(), 'validator2 should be removed').be.false;
    expect(await stakeManager.usedEvidence(hash2)).be.true;
    try {
      await stakeManager.freeze(validatorAddr, hash2);
      assert.fail('should slash failed when hash exists');
    } catch (err) {}
  });

  it('should unstake and claim correctly', async () => {
    const stakeAmount = BigNumber.from(100);
    const unstakeAmount = BigNumber.from(16);
    const rewardAmount = BigNumber.from(97);
    const deployerAddr = await deployer.getAddress();
    const validatorAddr = await validator3.getAddress();
    const receiver1Addr = await receiver1.getAddress();
    const receiver2Addr = await receiver2.getAddress();
    const commissionRate = 33;
    const receiver1BalStart = await ethers.provider.getBalance(receiver1Addr);
    const receiver2BalStart = await ethers.provider.getBalance(receiver2Addr);
    const id1 = stakeId++;
    await stakeManager.stake(validatorAddr, deployerAddr, { value: stakeAmount });
    const commissionShare = await createCommissionShareContract(validatorAddr);
    await stakeManager.connect(validator3).setCommissionRate(commissionRate);
    await commissionShare.approve(stakeManager.address, MAX_INTEGER.toString());

    expect((await ethers.provider.getBalance(commissionShare.address)).toString(), 'commissionShare balance should be equal').be.equal(stakeAmount.toString());

    await stakeManager.reward(validatorAddr, { value: rewardAmount });
    const commissionAmount = rewardAmount.mul(commissionRate).div(100);
    const commissionTotalSup = await commissionShare.totalSupply();
    const validatorKeeperAmount = rewardAmount.sub(commissionAmount);
    const claimAmount = await validatorRewardPool.balanceOf(validatorAddr);
    expect(claimAmount.eq(validatorKeeperAmount), 'validatorKeeper balance should be equal').be.true;

    const commissionBal = await ethers.provider.getBalance(commissionShare.address);
    await stakeManager.startUnstake(validatorAddr, receiver1Addr, unstakeAmount.toString());
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
    const deployerAddr = await deployer.getAddress();
    const validatorAddr = await validator4.getAddress();
    const totalLockedAmountBefore = await stakeManager.totalLockedAmount();
    const votingPower = await stakeManager.getVotingPowerByAddress(validatorAddr);
    await stakeManager.stake(validatorAddr, deployerAddr, { value: minIndexVotingPower });
    const v = await stakeManager.validators(validatorAddr);
    expect(await stakeManager.indexedValidatorsExists(v.id), 'validator should in indexedValidators').to.equal(true);
    const jailThreshold = await config.jailThreshold();
    const missedRecord: MissRecord[] = [[validatorAddr, jailThreshold]];
    await stakeManager.addMissRecord(missedRecord);
    const minerState = await prison.miners(validatorAddr);
    expect(minerState.jailed, 'validator should be jailed').be.equal(true);
    expect(await stakeManager.indexedValidatorsExists(v.id), 'validator should not in indexedValidators').to.equal(false);
    const totalCalAmountAfter = await stakeManager.totalLockedAmount();
    expect(totalCalAmountAfter.toString(), 'totalCalAmount should be equal').be.equal((Number(totalLockedAmountBefore) - Number(votingPower)).toString());
  });

  it('should not index jailed validator ', async () => {
    const totalLockedAmount = await stakeManager.totalLockedAmount();
    const deployerAddr = await deployer.getAddress();
    const validatorAddr = await validator4.getAddress();
    const v = await stakeManager.validators(validatorAddr);
    expect(await stakeManager.indexedValidatorsExists(v.id), 'validator should not in indexedValidators').to.equal(false);

    await stakeManager.stake(validatorAddr, deployerAddr, { value: minIndexVotingPower.mul(10) });
    expect(await stakeManager.totalLockedAmount(), 'totalLockedAmount should be equal').be.equal(totalLockedAmount);
    expect(await stakeManager.indexedValidatorsExists(v.id), 'validator should not in indexedValidators').to.equal(false);

    await stakeManager.reward(validatorAddr, { value: minIndexVotingPower.mul(100) });
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
    const validatorAddr = await validator4.getAddress();
    const totalLockedAmount = await stakeManager.totalLockedAmount();
    await stakeManager.freeze(validatorAddr, bufferToHex(crypto.randomBytes(32)));
    await stakeManager.unfreeze(validatorAddr, 40);
    expect(await stakeManager.totalLockedAmount(), 'totalLockedAmount should be equal').be.equal(totalLockedAmount);
    const commissionShare = await createCommissionShareContract(validatorAddr);
    await commissionShare.approve(stakeManager.address, MAX_INTEGER.toString());
    await stakeManager.startUnstake(validatorAddr, await deployer.getAddress(), 1);
    expect(await stakeManager.totalLockedAmount(), 'totalLockedAmount should be equal').be.equal(totalLockedAmount);
    const claimAmount = await validatorRewardPool.balanceOf(validatorAddr);
    await stakeManager.connect(validator4).startClaim(await receiver2.getAddress(), claimAmount);
    expect(await stakeManager.totalLockedAmount(), 'totalLockedAmount should be equal').be.equal(totalLockedAmount);
  });

  it('should unjail validator correctly', async () => {
    const validatorAddr = await validator4.getAddress();
    const forfeit = await config.forfeit();
    const totalLockedAmountBefore = await stakeManager.totalLockedAmount();
    const votingPower = await stakeManager.getVotingPowerByAddress(validatorAddr);
    await stakeManager.connect(validator4).unjail({ value: forfeit });
    const totalLockedAmountAfter = await stakeManager.totalLockedAmount();
    expect(totalLockedAmountAfter.toString(), 'totalLockedAmount should be equal').be.equal((Number(totalLockedAmountBefore) + Number(votingPower)).toString());
    const v = await stakeManager.validators(validatorAddr);
    expect(await stakeManager.indexedValidatorsExists(v.id), 'validator should in indexedValidators').to.equal(true);
    const minerState = await prison.miners(validatorAddr);
    expect(minerState.jailed, 'validator should not be jailed').be.equal(false);
  });

  it('should freeze validator and unfreeze with percentage penalty', async () => {
    const deployerAddr = await deployer.getAddress();
    const testLogic = async (validator: Signer, penalty: number) => {
      const validatorAddr = await validator.getAddress();
      await stakeManager.stake(validatorAddr, deployerAddr, { value: minIndexVotingPower });
      const validatorInfo = await stakeManager.validators(validatorAddr);
      expect(await stakeManager.indexedValidatorsExists(validatorInfo.id), 'validator should in indexedValidators').to.equal(true);
      const totalLockedAmount = await stakeManager.totalLockedAmount();
      const votingPower = await stakeManager.getVotingPowerByAddress(validatorAddr);
      await stakeManager.connect(deployer).freeze(validatorAddr, bufferToHex(crypto.randomBytes(32)));
      expect(await stakeManager.frozen(validatorAddr), 'validator should fronzen').be.equal(true);
      expect(await stakeManager.indexedValidatorsExists(validatorInfo.id), 'validator should not in indexedValidators').to.equal(false);
      assert(totalLockedAmount.eq((await stakeManager.totalLockedAmount()).add(votingPower)), 'totalLockedAmount should be equal');
      await stakeManager.connect(deployer).unfreeze(validatorAddr, penalty);
      expect(await stakeManager.frozen(validatorAddr), 'validator should not fronzen').be.equal(false);
      if (penalty == 0) {
        //0 penalty unfreeze
        assert(totalLockedAmount.eq(await stakeManager.totalLockedAmount()), 'totalLockedAmount should be equal');
        assert(votingPower.eq(await stakeManager.getVotingPowerByAddress(validatorAddr)), 'validator voting power should be equal');
        expect(await stakeManager.indexedValidatorsExists(validatorInfo.id), 'validator should in indexedValidators').to.equal(true);
      } else if (penalty == 50) {
        //50% penalty unfreeze
        assert(totalLockedAmount.eq((await stakeManager.totalLockedAmount()).add(votingPower.div(2))), 'totalLockedAmount should be equal');
        assert(votingPower.sub(votingPower.div(2)).eq(await stakeManager.getVotingPowerByAddress(validatorAddr)), 'validator voting power should be equal');
        expect(await stakeManager.indexedValidatorsExists(validatorInfo.id), 'validator should not in indexedValidators').to.equal(false);
      } else if (penalty == 100) {
        //100% penalty unfreeze
        assert(totalLockedAmount.eq((await stakeManager.totalLockedAmount()).add(votingPower)), 'totalLockedAmount should be equal');
        assert(BigNumber.from(0).eq(await stakeManager.getVotingPowerByAddress(validatorAddr)), 'validator voting power should be equal');
        expect(await stakeManager.indexedValidatorsExists(validatorInfo.id), 'validator should not in indexedValidators').to.equal(false);
      }
    };

    await testLogic(validator5, 0);
    await testLogic(validator6, 50);
    await testLogic(validator7, 100);
  });

  it('should freeze validator and unfreeze with reward penalty', async () => {
    const testLogic = async function (validator: Signer, amount: BigNumber) {
      const validatorAddr = await validator.getAddress();
      await stakeManager.reward(validatorAddr, { value: minIndexVotingPower.mul(2) });
      const validatorInfo = await stakeManager.validators(validatorAddr);
      expect(await stakeManager.indexedValidatorsExists(validatorInfo.id), 'validator should in indexedValidators').to.equal(true);
      const totalLockedAmount = await stakeManager.totalLockedAmount();
      const votingPower = await stakeManager.getVotingPowerByAddress(validatorAddr);
      await stakeManager.freeze(validatorAddr, bufferToHex(crypto.randomBytes(32)));
      expect(await stakeManager.frozen(validatorAddr), 'validator should be frozen').be.equal(true);
      expect(await stakeManager.indexedValidatorsExists(validatorInfo.id), 'validator should not in indexedValidators').to.equal(false);
      assert(totalLockedAmount.eq((await stakeManager.totalLockedAmount()).add(votingPower)), 'totalLockedAmount should be equal');
      await stakeManager.connect(deployer).unfreeze(validatorAddr, amount);
      expect(await stakeManager.frozen(validatorAddr), 'validator should not fronzen').be.equal(false);
      if (amount.eq(minIndexVotingPower)) {
        //unfreeze penalty for the amount of minIndexVotingPower
        assert(totalLockedAmount.sub(minIndexVotingPower.toString()).eq(await stakeManager.totalLockedAmount()), 'totalLockedAmount should be equal');
        assert(votingPower.sub(minIndexVotingPower.toString()).eq(await stakeManager.getVotingPowerByAddress(validatorAddr)), 'validator voting power should be equal');
        expect(await stakeManager.indexedValidatorsExists(validatorInfo.id), 'validator should in indexedValidators').to.equal(true);
      } else if (amount.eq(minIndexVotingPower.mul(2))) {
        //unfreeze penalty for the amount of minIndexVotingPower * 2
        assert(totalLockedAmount.sub(minIndexVotingPower.mul(2)).eq(await stakeManager.totalLockedAmount()), 'totalLockedAmount should be equal');
        assert(votingPower.sub(minIndexVotingPower.mul(2)).eq(await stakeManager.getVotingPowerByAddress(validatorAddr)), 'validator voting power should be equal');
        expect(await stakeManager.indexedValidatorsExists(validatorInfo.id), 'validator should not in indexedValidators').to.equal(false);
      }
    };

    await testLogic(validator5, minIndexVotingPower);
    await testLogic(validator6, minIndexVotingPower.mul(2));
  });

  it('should can not call some function with the validator freezed', async () => {
    const validator = validator8;
    const validatorAddr = await validator.getAddress();
    await stakeManager.stake(validatorAddr, validatorAddr, { value: minIndexVotingPower });
    await stakeManager.reward(validatorAddr, { value: minIndexVotingPower });
    const commissionShare = await createCommissionShareContract(validatorAddr);
    await commissionShare.connect(validator).approve(stakeManager.address, MAX_INTEGER.toString());
    await stakeManager.connect(validator).startUnstake(validatorAddr, validatorAddr, minIndexVotingPower);
    const id = (await stakeManager.unstakeId()).sub(1);
    await stakeManager.freeze(validatorAddr, bufferToHex(crypto.randomBytes(32)));
    let failed = false;
    try {
      await stakeManager.connect(validator).stake(validatorAddr, validatorAddr, { value: 1 });
      failed = true;
    } catch (e) {}
    if (failed) {
      assert.fail('should not be able to stake');
    }

    try {
      await stakeManager.connect(validator).startClaim(validatorAddr, 1);
      failed = true;
    } catch (e) {}
    if (failed) {
      assert.fail('should not be able to claim');
    }

    try {
      await stakeManager.connect(validator).unstake(id.toString());
      failed = true;
    } catch (e) {}
    if (failed) {
      assert.fail('should not be able to unstake');
    }

    await stakeManager.connect(deployer).unfreeze(validatorAddr, 0);
    try {
      await stakeManager.connect(validator).stake(validatorAddr, validatorAddr, { value: 1 });
    } catch (e) {
      assert.fail('should not be able to stake');
    }

    try {
      await stakeManager.connect(validator).startClaim(validatorAddr, 1);
    } catch (e) {
      assert.fail('should not be able to claim');
    }

    try {
      await stakeManager.connect(validator).unstake(id);
    } catch (e) {
      console.log('eeeee', e);
      assert.fail('should not be able to unstake');
    }
  });

  it('should freeze and jail logic are compatible with each other', async () => {
    const validator = validator9;
    const validatorAddr = await validator.getAddress();
    const jailThreshold = await config.jailThreshold();
    const forfeit = await config.forfeit();
    const missedRecord: MissRecord[] = [[validatorAddr, jailThreshold]];

    await stakeManager.stake(validatorAddr, validatorAddr, { value: minIndexVotingPower });
    await stakeManager.reward(validatorAddr, { value: minIndexVotingPower });
    let totalLockedAmount = await stakeManager.totalLockedAmount();
    let votingPower = await stakeManager.getVotingPowerByAddress(validatorAddr);

    const testLogic = async function (firstLock: 'freeze' | 'addMissRecord', firstUnlock: 'unfreeze' | 'unjail') {
      let totalLockedAmount1: BigNumber;
      let totalLockedAmount2: BigNumber;
      let totalLockedAmount3: BigNumber;
      let totalLockedAmount4: BigNumber;
      if (firstLock == 'freeze') {
        await stakeManager.freeze(validatorAddr, bufferToHex(crypto.randomBytes(32)));
        totalLockedAmount1 = await stakeManager.totalLockedAmount();
        await stakeManager.addMissRecord(missedRecord);
      } else if (firstLock == 'addMissRecord') {
        await stakeManager.addMissRecord(missedRecord);
        totalLockedAmount1 = await stakeManager.totalLockedAmount();
        await stakeManager.freeze(validatorAddr, bufferToHex(crypto.randomBytes(32)));
      }
      totalLockedAmount2 = await stakeManager.totalLockedAmount();
      assert(totalLockedAmount.sub(votingPower).eq(totalLockedAmount1!), 'totalLockedAmount should be equal');
      assert(totalLockedAmount1!.eq(totalLockedAmount2), 'totalLockedAmount should be equal');

      if (firstUnlock == 'unfreeze') {
        await stakeManager.connect(deployer).unfreeze(validatorAddr, 0);
        totalLockedAmount3 = await stakeManager.totalLockedAmount();
        await stakeManager.connect(validator).unjail({ value: forfeit });
        totalLockedAmount4 = await stakeManager.totalLockedAmount();
      } else if (firstUnlock == 'unjail') {
        await stakeManager.connect(validator).unjail({ value: forfeit });
        totalLockedAmount3 = await stakeManager.totalLockedAmount();
        await stakeManager.connect(deployer).unfreeze(validatorAddr, 0);
        totalLockedAmount4 = await stakeManager.totalLockedAmount();
      }
      assert(totalLockedAmount3!.eq(totalLockedAmount2), 'totalLockedAmount should be equal');
      assert(totalLockedAmount4!.eq(totalLockedAmount), 'totalLockedAmount should be equal');
    };

    await testLogic('freeze', 'unfreeze');
    await testLogic('freeze', 'unjail');
    await testLogic('addMissRecord', 'unfreeze');
    await testLogic('addMissRecord', 'unjail');
  });
});
