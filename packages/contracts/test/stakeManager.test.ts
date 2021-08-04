import type { Artifacts } from 'hardhat/types';
import type Web3 from 'web3';
import { assert, expect } from 'chai';
import { BN } from 'ethereumjs-util';

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

  async function createShareContract(validator: string) {
    const address = await stakeManager.methods.validatorToShare(validator).call();
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
    const minStakeAmount = new BN(await config.methods.minStakeAmount().call());
    try {
      await stakeManager.methods.stake(validator, delpoyer).send({ value: minStakeAmount.subn(1).toString() });
      assert.fail("shouldn't stake succeed");
    } catch (err) {}
  });

  it('should stake succeed', async () => {
    const minStakeAmount = new BN(await config.methods.minStakeAmount().call());
    await stakeManager.methods.stake(validator, delpoyer).send({ value: minStakeAmount.toString() });
    const shares = await (await createShareContract(validator)).methods.balanceOf(delpoyer).call();
    expect(shares, 'shares should be equal to amount at the time of the first staking').to.equal(minStakeAmount.toString());
  });

  it('should slash succeed', async () => {
    const reason = 0;
    const factor = toBN(await config.methods.getFactorByReason(reason).call());
    const share = await createShareContract(validator);
    const balBeforeSlash = toBN(await web3.eth.getBalance(share.options.address));
    await stakeManager.methods.slash(validator, reason).send();
    const balAfterSlash = toBN(await web3.eth.getBalance(share.options.address));
    expect(balBeforeSlash.mul(new BN(100).sub(factor)).divn(100).toString(), "share's balance should slashed by factor").to.equal(balAfterSlash.toString());
  });
});
