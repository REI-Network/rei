import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract, ContractFactory, Signer } from 'ethers';

describe('FeePool', () => {
  let config: Contract;
  let feePool: Contract;
  let stakeManager: Contract;
  let validatorRewardPool: Contract;
  let deployer: Signer;
  let validator1: Signer;
  let validator2: Signer;
  let validator3: Signer;

  let deployerAddr: string;
  let validator1Addr: string;
  let validator2Addr: string;
  let validator3Addr: string;

  let prisonFactory: ContractFactory;
  let configFactory: ContractFactory;
  let feePoolFactory: ContractFactory;
  let stakeManagerFactory: ContractFactory;
  let validatorRewardPoolFactory: ContractFactory;

  before(async () => {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    validator1 = signers[1];
    validator2 = signers[2];
    validator3 = signers[3];
    deployerAddr = await deployer.getAddress();
    validator1Addr = await validator1.getAddress();
    validator2Addr = await validator2.getAddress();
    validator3Addr = await validator3.getAddress();
    prisonFactory = await ethers.getContractFactory('Prison');
    configFactory = await ethers.getContractFactory('Config_devnet');
    feePoolFactory = await ethers.getContractFactory('FeePool');
    stakeManagerFactory = await ethers.getContractFactory('StakeManager');
    validatorRewardPoolFactory = await ethers.getContractFactory(
      'ValidatorRewardPool'
    );
  });

  it('should deploy succeed', async () => {
    config = await configFactory.connect(deployer).deploy();
    await config.setSystemCaller(deployerAddr);
    await config.setFeePoolInterval(10000);

    stakeManager = await stakeManagerFactory
      .connect(deployer)
      .deploy(config.address, deployerAddr, [], []);
    await config.setStakeManager(stakeManager.address);
    const prison = await prisonFactory.connect(deployer).deploy(config.address);
    await config.setPrison(prison.address);

    feePool = await feePoolFactory.connect(deployer).deploy(config.address);
    await config.setFeePool(feePool.address);

    validatorRewardPool = await validatorRewardPoolFactory
      .connect(deployer)
      .deploy(config.address);
    await config.setValidatorRewardPool(validatorRewardPool.address);

    expect(
      await config.feePoolInterval(),
      'fee pool interval should be equal'
    ).be.equal('10000');
    expect(
      await config.stakeManager(),
      'stake manager address should be equal'
    ).be.equal(stakeManager.address);
    expect(await config.feePool(), 'fee pool address should be equal').be.equal(
      feePool.address
    );
    expect(
      await config.validatorRewardPool(),
      'validator reward pool address should be equal'
    ).be.equal(validatorRewardPool.address);
  });

  it('should get validators length correctly', async () => {
    await feePool.distribute(validator1Addr, 0);
    let validatorsLength = await feePool.validatorsLength();
    expect(validatorsLength.eq(0), 'validators length should be equal').be.true;

    await feePool.distribute(validator1Addr, 100);
    validatorsLength = await feePool.validatorsLength();
    expect(validatorsLength.eq(1), 'validators length should be equal').be.true;

    await feePool.distribute(validator2Addr, 100);
    validatorsLength = await feePool.validatorsLength();
    expect(validatorsLength.eq(2), 'validators length should be equal').be.true;

    await feePool.distribute(validator3Addr, 100);
    validatorsLength = await feePool.validatorsLength();
    expect(validatorsLength.eq(3), 'validators length should be equal').be.true;
  });

  it('should distribute correctly(1)', async () => {
    let totalShares = await feePool.totalShares();
    let validator2Shares = await feePool.sharesOf(validator2Addr);
    let validator3Shares = await feePool.sharesOf(validator3Addr);
    expect(totalShares.eq(300), 'totalShares should be equal1').be.true;
    expect(validator2Shares.eq(100), 'validator2 shares should be equal').be
      .true;
    expect(validator3Shares.eq(100), 'validator3 shares should be equal').be
      .true;

    await feePool.distribute(validator2Addr, 100);
    totalShares = await feePool.totalShares();
    validator2Shares = await feePool.sharesOf(validator2Addr);
    expect(totalShares.eq(400), 'totalShares should be equal2').be.true;
    expect(validator2Shares.eq(200), 'validator2 shares should be equal').be
      .true;

    await feePool.distribute(validator3Addr, 200);
    totalShares = await feePool.totalShares();
    validator3Shares = await feePool.sharesOf(validator3Addr);
    expect(totalShares.eq(600), 'totalShares should be equal3').be.true;
    expect(validator3Shares.eq(300), 'validator3 shares should be equal').be
      .true;
  });

  it('should accumulate correctly(2)', async () => {
    let poolBalance = await ethers.provider.getBalance(feePool.address);
    expect(poolBalance.toString(), 'pool balance should be equal').be.equal(
      '0'
    );

    await feePool.distribute(validator1Addr, 0, { value: 600 });
    poolBalance = await ethers.provider.getBalance(feePool.address);
    expect(poolBalance.toString(), 'pool balance should be equal').be.equal(
      '600'
    );
  });

  it('should accumulate correctly(3)', async () => {
    const validator1Rate = 40;
    const validator2Rate = 50;
    const validator3Rate = 60;
    const poolBalanceBefore = await ethers.provider.getBalance(feePool.address);
    const totalSharesBefore = await feePool.totalShares();
    const globalTimestampBefore = await feePool.globalTimestamp();
    const validator1SharesBefore = await feePool.sharesOf(validator1Addr);
    const validator2SharesBefore = await feePool.sharesOf(validator2Addr);
    const validator3SharesBefore = await feePool.sharesOf(validator3Addr);
    expect(validator1SharesBefore.eq(100), 'validator1 shares should be equal')
      .be.true;
    expect(validator2SharesBefore.eq(200), 'validator2 shares should be equal')
      .be.true;
    expect(validator3SharesBefore.eq(300), 'validator3 shares should be equal')
      .be.true;
    expect(poolBalanceBefore.eq(600), 'pool balance should be equal').be.true;
    expect(totalSharesBefore.eq(600), 'totalShares should be euqal').be.true;

    await stakeManager.stake(validator1Addr, deployerAddr, { value: 1000 });
    await stakeManager.stake(validator2Addr, deployerAddr, { value: 1000 });
    await stakeManager.stake(validator3Addr, deployerAddr, { value: 1000 });
    await stakeManager.connect(validator1).setCommissionRate(validator1Rate);
    await stakeManager.connect(validator2).setCommissionRate(validator2Rate);
    await stakeManager.connect(validator3).setCommissionRate(validator3Rate);

    await config.setFeePoolInterval(0);
    await feePool.distribute(validator1Addr, 0);

    const validator1Reward = await validatorRewardPool.balanceOf(
      validator1Addr
    );
    const validator2Reward = await validatorRewardPool.balanceOf(
      validator2Addr
    );
    const validator3Reward = await validatorRewardPool.balanceOf(
      validator3Addr
    );
    const _validator1Reward = poolBalanceBefore
      .mul(validator1SharesBefore)
      .div(totalSharesBefore)
      .mul(100 - validator1Rate)
      .div(100);
    const _validator2Reward = poolBalanceBefore
      .mul(validator2SharesBefore)
      .div(totalSharesBefore)
      .mul(100 - validator2Rate)
      .div(100);
    const _validator3Reward = poolBalanceBefore
      .mul(validator3SharesBefore)
      .div(totalSharesBefore)
      .mul(100 - validator3Rate)
      .div(100);
    expect(
      validator1Reward.eq(_validator1Reward),
      'validator1 reward should be equal to computation'
    ).be.true;
    expect(
      validator2Reward.eq(_validator2Reward),
      'validator2 reward should be equal to computation'
    ).be.true;
    expect(
      validator3Reward.eq(_validator3Reward),
      'validator3 reward should be equal to computation'
    ).be.true;

    const poolBalanceAfter = await ethers.provider.getBalance(feePool.address);
    const totalSharesAfter = await feePool.totalShares();
    const globalTimestampAfter = await feePool.globalTimestamp();
    const validator1SharesAfter = await feePool.sharesOf(validator1Addr);
    const validator2SharesAfter = await feePool.sharesOf(validator2Addr);
    const validator3SharesAfter = await feePool.sharesOf(validator3Addr);
    expect(validator1SharesAfter.eq(0), 'validator1 shares should be equal').be
      .true;
    expect(validator2SharesAfter.eq(0), 'validator2 shares should be equal').be
      .true;
    expect(validator3SharesAfter.eq(0), 'validator3 shares should be equal').be
      .true;
    expect(poolBalanceAfter.eq(0), 'pool balance should be equal').be.true;
    expect(totalSharesAfter.eq(0), 'totalShares should be euqal').be.true;
    expect(
      globalTimestampAfter.gt(globalTimestampBefore),
      'global timestamp should be changed'
    ).be.true;
  });
});
