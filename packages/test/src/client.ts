import crypto from 'crypto';
import path from 'path';
import { BN, Address, bufferToHex } from 'ethereumjs-util';
import Web3 from 'web3';
import { Contract } from 'web3-eth-contract';
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
      this[contract] = new this.web3.eth.Contract(this.loadABI(contractName), await this.config.methods[contract]().call());
    };
    await initContract('stakeManager');
    await initContract('unstakePool');
    await initContract('validatorRewardPool');

    // add accounts
    this.accMngr.add([
      ['genesis1', Address.fromString('0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde'), Buffer.from('225a70405aa06a0dc0451fb51a9284a0dab949257f8a2df90192b5238e76936a', 'hex')],
      ['admin', Address.fromString('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'), Buffer.from('ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', 'hex')]
    ]);

    // create random accounts
    for (let i = 0; i < 3; i++) {
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
}
