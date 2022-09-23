import type Web3 from 'web3';
import { assert, expect } from 'chai';
import { BN, MAX_INTEGER } from 'ethereumjs-util';
import { upTimestamp, toBN } from './utils';

declare var artifacts: any;
declare var web3: Web3;

const Config = artifacts.require('Config_devnet');
const Jail = artifacts.require('Prison');

describe('Prison', () => {
  let config: any;
  let prison: any;
  let deployer: any;
  let user1: any;

  before(async () => {
    const accounts = await web3.eth.getAccounts();
    deployer = accounts[0];
    user1 = accounts[1];
  });

  it('should deploy succeed', async () => {
    config = new web3.eth.Contract(Config.abi, (await Config.new()).address, { from: deployer });
    await config.methods.setSystemCaller(deployer).send();

    prison = new web3.eth.Contract(Jail.abi, (await Jail.new(config.options.address)).address, { from: deployer });
    await config.methods.setJail(prison.options.address).send();
  });
});
