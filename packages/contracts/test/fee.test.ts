import type { Artifacts } from 'hardhat/types';
import type Web3 from 'web3';
import { assert, expect } from 'chai';
import { BN } from 'ethereumjs-util';

declare var artifacts: Artifacts;
declare var web3: Web3;

const Config = artifacts.require('Config_test');
const Fee = artifacts.require('Fee');
const FeeManager = artifacts.require('FeeManager');

describe('Fee', () => {
  let config: any;
  let fee: any;
  let feeManager: any;
  let deployer: any;
  let user: any;

  before(async () => {
    const accounts = await web3.eth.getAccounts();
    deployer = accounts[0];
    user = accounts[1];
  });

  it('should deploy succeed', async () => {
    config = new web3.eth.Contract(Config.abi, (await Config.new()).address, { from: deployer });
    fee = new web3.eth.Contract(Fee.abi, (await Fee.new(config.options.address)).address, { from: deployer });
    feeManager = new web3.eth.Contract(FeeManager.abi, (await FeeManager.new(config.options.address)).address, { from: deployer });
    await config.methods.setFeeManager(feeManager.options.address).send();
    expect(await config.methods.feeManager().call(), 'fee manager address should be equal').be.equal(feeManager.options.address);
  });
});
