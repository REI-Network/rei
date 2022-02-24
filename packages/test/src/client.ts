import crypto from 'crypto';
import path from 'path';
import { BN, Address, bufferToHex } from 'ethereumjs-util';
import Web3 from 'web3';
import { Contract } from 'web3-eth-contract';
import { TransactionReceipt } from 'web3-core';
import { hexStringToBN } from '../../utils';
import { MockAccountManager } from '../../core/test/util';

export type TxOptions = {
  from?: string;
  to?: string;
  value?: string;
};

export class Client {
  readonly web3: Web3;
  readonly configAddress: string;
  readonly accMngr: MockAccountManager;
  config!: Contract;
  stakeManager!: Contract;
  unstakePool!: Contract;
  validatorRewardPool!: Contract;
  fee!: Contract;
  feePool!: Contract;
  feeToken!: Contract;

  constructor(provider = 'ws://127.0.0.1:11451', configAddress = '0x0000000000000000000000000000000000001000') {
    this.web3 = new Web3(provider);
    this.configAddress = configAddress;
    this.accMngr = new MockAccountManager([]);
  }

  private loadABI(contract: string, file?: string) {
    return require(path.join(__dirname, `../../contracts/artifacts/src/${contract}.sol/${file ?? contract}.json`)).abi;
  }

  async init() {
    this.config = new this.web3.eth.Contract(this.loadABI('Config_devnet'), this.configAddress);

    const initContract = async (contract: string) => {
      const contractName = contract.substr(0, 1).toUpperCase() + contract.substr(1);
      const address = await this.config.methods[contract]().call();
      this[contract] = new this.web3.eth.Contract(this.loadABI(contractName), address);
    };
    await initContract('stakeManager');
    await initContract('unstakePool');
    await initContract('validatorRewardPool');
    await initContract('fee');
    await initContract('feePool');
    await initContract('feeToken');

    // add accounts
    this.accMngr.add([
      ['genesis1', Address.fromString('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde'), Buffer.from('225a70405aa06a0dc0451fb51a9284a0dab949257f8a2df90192b5238e76936a', 'hex')],
      ['admin', Address.fromString('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'), Buffer.from('ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', 'hex')]
    ]);

    // create random accounts
    for (let i = 0; i < 5; i++) {
      const priv = crypto.randomBytes(32);
      const addr = Address.fromPrivateKey(priv);
      this.accMngr.add([[`test${i}`, addr, priv]]);
    }

    // unlock all accounts
    for (const [name, addr] of this.accMngr.nameToAddress) {
      this.web3.eth.accounts.wallet.add({
        address: addr.toString(),
        privateKey: bufferToHex(this.accMngr.n2p(name))
      });
    }
  }

  sendTestTransaction(gasPrice: BN, options?: TxOptions) {
    return this.web3.eth.sendTransaction({
      from: this.accMngr.n2a(options?.from ?? 'test1').toString(),
      to: this.accMngr.n2a(options?.to ?? 'genesis1').toString(),
      value: options?.value ?? 0,
      gas: 21000,
      gasPrice: gasPrice.toString()
    });
  }

  parseUsageInfo(receipt: TransactionReceipt) {
    if (receipt.logs) {
      if (receipt.logs.length === 0) {
        throw new Error('invalid receipt');
      }

      const log = receipt.logs[receipt.logs.length - 1];
      if (log.address !== this.fee.options.address) {
        throw new Error('invalid log');
      }

      if (log.topics.length !== 3) {
        throw new Error('invalid log');
      }

      if (log.topics[0] !== '0x873c82cd37aaacdcf736cbb6beefc8da36d474b65ad23aaa1b1c6fbd875f7076') {
        throw new Error('invalid log');
      }

      return {
        feeUsage: hexStringToBN(log.topics[1]),
        balanceUsage: hexStringToBN(log.topics[2])
      };
    } else if (receipt.events) {
      if (!receipt.events.Usage) {
        throw new Error('invalid log');
      }

      return {
        feeUsage: new BN(receipt.events.Usage.returnValues.feeUsage),
        balanceUsage: new BN(receipt.events.Usage.returnValues.balanceUsage)
      };
    } else {
      throw new Error('invalid log');
    }
  }
}
