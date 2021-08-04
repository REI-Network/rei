import type { Artifacts } from 'hardhat/types';
import type Web3 from 'web3';
import { assert, expect } from 'chai';
import { BN, MAX_INTEGER } from 'ethereumjs-util';

declare var artifacts: Artifacts;
declare var web3: Web3;

const Config = artifacts.require('Config');
const Share = artifacts.require('Share');
const StakeManager = artifacts.require('StakeManager');

describe('StakeManger', () => {
  let config: any;
  let stakeManager: any;
  let delpoyer: string;
  let validator: string;
  let receiver: string;

  async function createShareContract(validator: string, isStake = true) {
    const address = isStake ? await stakeManager.methods.validatorToShare(validator).call() : await stakeManager.methods.validatorToUnstakeShare(validator).call();
    return new web3.eth.Contract(Share.abi, address, { from: delpoyer });
  }

  function toBN(data: number | string) {
    if (typeof data === 'number') {
      return new BN(data);
    } else if (data.startsWith('0x')) {
      return new BN(data.substr(2), 'hex');
    }
    return new BN(data);
  }

  before(async () => {
    const accounts = await web3.eth.getAccounts();
    delpoyer = accounts[0];
    validator = accounts[1];
    receiver = accounts[2];
    console.log('receiver:', receiver, await web3.eth.getBalance(receiver));
  });

  it('should deploy succeed', async () => {
    config = new web3.eth.Contract(Config.abi, (await Config.new()).address, { from: delpoyer });
    stakeManager = new web3.eth.Contract(StakeManager.abi, (await StakeManager.new(config.options.address)).address, { from: delpoyer });
    await config.methods.setStakeManager(stakeManager.options.address).send();
  });

  it('should initialize succeed', async () => {
    expect(await stakeManager.methods.firstId().call(), 'firstId should be equal to 0').to.equal('0');
    expect(await stakeManager.methods.lastId().call(), 'lastId should be equal to 0').to.equal('0');
    expect(await stakeManager.methods.validatorsLength().call(), 'validatorsLength should be equal to 0').to.equal('0');
  });

  it('should stake failed(min stake amount)', async () => {
    const minStakeAmount = toBN(await config.methods.minStakeAmount().call());
    try {
      await stakeManager.methods.stake(validator, delpoyer).send({ value: minStakeAmount.subn(1).toString() });
      assert.fail("shouldn't stake succeed");
    } catch (err) {}
  });

  it('should stake succeed', async () => {
    const minStakeAmount = toBN(await config.methods.minStakeAmount().call());
    await stakeManager.methods.stake(validator, delpoyer).send({ value: minStakeAmount.toString() });
    const shares = await (await createShareContract(validator)).methods.balanceOf(delpoyer).call();
    expect(shares, 'shares should be equal to amount at the time of the first staking').to.equal(minStakeAmount.toString());
  });

  it('should approve succeed', async () => {
    const share = await createShareContract(validator);
    await share.methods.approve(stakeManager.options.address, MAX_INTEGER.toString()).send();
  });

  it('should unstake succeed', async () => {
    const unstakeDelay = toBN(await config.methods.unstakeDelay().call()).toNumber();
    const minUnstakeShares = toBN(await stakeManager.methods.estimateMinUnstakeShares(validator).call());

    const share = await createShareContract(validator);
    const shrBeforeUnstake = toBN(await share.methods.balanceOf(delpoyer).call());
    await stakeManager.methods.startUnstake(validator, receiver, minUnstakeShares.toString()).send();
    const shrAfterUnstake = toBN(await share.methods.balanceOf(delpoyer).call());

    expect(shrBeforeUnstake.sub(minUnstakeShares).toString(), 'shares should be equal').to.equal(shrAfterUnstake.toString());
    expect(await share.methods.totalSupply().call(), 'total supply should be equal').to.equal(shrAfterUnstake.toString());

    // sleep until unstake delay
    await new Promise((r) => setTimeout(r, unstakeDelay * 1000 + 100));

    // send a transaction to update blockchain timestamp
    await web3.eth.sendTransaction({
      from: delpoyer,
      to: delpoyer,
      value: 0
    });

    // the unstake id should be `0`, so we directly use `0` to get `unstakeShares`
    const unstakeShares = (await stakeManager.methods.unstakeQueue(0).call()).unstakeShares;
    const estimateUnStakeAmount = toBN(await stakeManager.methods.estimateUnStakeAmount(validator, unstakeShares).call());
    const balBeforeUnstake = toBN(await web3.eth.getBalance(receiver));
    await stakeManager.methods.doUnstake().send();
    const balAfterUnstake = toBN(await web3.eth.getBalance(receiver));

    expect(balBeforeUnstake.add(estimateUnStakeAmount).toString(), 'receiver balance should be equal to the estimated value').to.equal(balAfterUnstake.toString());
  });
});
