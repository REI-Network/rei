import path from 'path';
import { BN } from 'ethereumjs-util';
import Web3 from 'web3';
import { Contract } from 'web3-eth-contract';

export class Client {
  readonly web3: Web3;
  readonly configAddress: string;
  config!: Contract;
  fee!: Contract;
  freeFee!: Contract;
  feePool!: Contract;
  router!: Contract;
  contractFee!: Contract;
  stakeManager!: Contract;
  unstakePool!: Contract;
  validatorRewardPool!: Contract;

  constructor(provider: string, configAddress: string) {
    this.web3 = new Web3(provider);
    this.configAddress = configAddress;
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
    await initContract('fee');
    await initContract('freeFee');
    await initContract('feePool');
    await initContract('router');
    await initContract('contractFee');
    await initContract('stakeManager');
    await initContract('unstakePool');
    await initContract('validatorRewardPool');
  }

  parseUsageInfoLog(log: any) {
    if (log.address !== this.router.options.address) {
      throw new Error('invalid logger address');
    }
    if (log.data.length !== 2 + 64 * 4) {
      throw new Error('invalid log data');
    }
    const data: string = log.data.substr(2);
    let index = 0;
    const feeUsage = new BN(data.substr(index++ * 64, 64), 'hex');
    const freeFeeUsage = new BN(data.substr(index++ * 64, 64), 'hex');
    const contractFeeUsage = new BN(data.substr(index++ * 64, 64), 'hex');
    const balanceUsage = new BN(data.substr(index++ * 64, 64), 'hex');
    return { feeUsage, freeFeeUsage, contractFeeUsage, balanceUsage };
  }
}
