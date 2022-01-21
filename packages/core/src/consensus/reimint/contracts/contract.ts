import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import { Address, BN, MAX_INTEGER } from 'ethereumjs-util';
import Message from '@gxchain2-ethereumjs/vm/dist/evm/message';
import { Common } from '@rei-network/common';
import { hexStringToBuffer, logger } from '@rei-network/utils';
import { EMPTY_ADDRESS } from '../../../utils';
import { ActiveValidatorSet } from '../validatorSet';
import { encode } from './utils';

export abstract class Contract {
  evm: EVM;
  common: Common;
  methods: { [name: string]: Buffer };
  address: Address;

  constructor(evm: EVM, common: Common, methods: { [name: string]: Buffer }, address: Address) {
    this.evm = evm;
    this.common = common;
    this.methods = methods;
    this.address = address;
  }

  /**
   * Deploy genesis contracts for mainnet and testnet
   * @param evm - EVM instance
   * @param common - Common instance
   */
  static async deployReimintContracts(evm: EVM, common: Common) {
    const genesisValidators = ActiveValidatorSet.genesis(common);
    const activeValidators = genesisValidators.activeValidators();
    const activeSigners = activeValidators.map(({ validator }) => validator.toString());
    const priorities = activeValidators.map(({ priority }) => priority.toString());
    const cfgaddr = common.param('vm', 'cfgaddr');

    // deploy config contract
    await Contract.deployContract(evm, common, 'cfg');
    // deploy stake manager contract
    await Contract.deployContract(evm, common, 'sm', { types: ['address', 'address', 'address[]', 'int256[]'], values: [cfgaddr, genesisValidators.proposer.toString(), activeSigners, priorities] });

    const defaultArgs = { types: ['address'], values: [cfgaddr] };
    // deploy unstake pool contract
    await Contract.deployContract(evm, common, 'up', defaultArgs);
    // deploy validator reward pool contract
    await Contract.deployContract(evm, common, 'vrp', defaultArgs);
  }

  /**
   * Deploy free staking hardfork
   * @param evm - EVM instance
   * @param common - Common instance
   */
  static async deployFreeStakingContracts(evm: EVM, common: Common) {
    const cfgaddr = common.param('vm', 'cfgaddr');
    // deploy fee contract
    await Contract.deployContract(evm, common, 'f', { types: ['address'], values: [cfgaddr] });
    // deploy fee pool contract
    await Contract.deployContract(evm, common, 'fp', { types: ['address'], values: [cfgaddr] });
  }

  /**
   * Deploy hardfork 1 contracts
   * @param evm - EVM instance
   * @param common - Common instance
   */
  static async deployHardfork1Contracts(evm: EVM, common: Common) {
    // deploy config contract
    await Contract.deployContract(evm, common, 'cfg', undefined, true);
    // deploy stake manager contract
    await Contract.deployContract(evm, common, 'sm');
  }

  /**
   * Deploy genesis contracts for devnet
   * NOTE: devnet contains all contracts in genesis,
   *       but mainnet and testnet will collect all contracts through hard forks
   * @param evm - EVM instance
   * @param common - Common instance
   */
  // static async deployGenesisContracts_devnet(evm: EVM, common: Common) {
  //   const genesisValidators = ActiveValidatorSet.genesis(common);
  //   const activeValidators = genesisValidators.activeValidators();
  //   const activeSigners = activeValidators.map(({ validator }) => validator.toString());
  //   const priorities = activeValidators.map(({ priority }) => priority.toString());
  //   const cfgaddr = common.param('vm', 'cfgaddr');

  //   // deploy config contract
  //   await Contract.deployContract(evm, common, 'cfg');
  //   // deploy stake manager contract
  //   await Contract.deployContract(evm, common, 'sm', { types: ['address', 'address', 'address[]', 'int256[]'], values: [cfgaddr, genesisValidators.proposer.toString(), activeSigners, priorities] });

  //   const defaultArgs = { types: ['address'], values: [cfgaddr] };
  //   // deploy unstake pool contract
  //   await Contract.deployContract(evm, common, 'up', defaultArgs);
  //   // deploy validator reward pool contract
  //   await Contract.deployContract(evm, common, 'vrp', defaultArgs);
  //   // deploy fee contract
  //   await Contract.deployContract(evm, common, 'f', defaultArgs);
  //   // deploy fee pool contract
  //   await Contract.deployContract(evm, common, 'fp', defaultArgs);
  // }

  /**
   * Deploy free staking contracts for mainnet and testnet
   * @param evm - EVM instance
   * @param common - Common instance
   */
  // static async deployFreeStakingContracts(evm: EVM, common: Common) {
  //   // deploy config contract
  //   await Contract.deployContract(evm, common, 'cfg', undefined, true);
  //   // deploy stake manager contract
  //   await Contract.deployContract(evm, common, 'sm');

  //   const cfgaddr = common.param('vm', 'cfgaddr');
  //   const defaultArgs = { types: ['address'], values: [cfgaddr] };
  //   // deploy fee contract
  //   await Contract.deployContract(evm, common, 'f', defaultArgs);
  //   // deploy fee pool contract
  //   await Contract.deployContract(evm, common, 'fp', defaultArgs);
  // }

  /**
   * Deploy contract to target address
   * @param evm - EVM instance
   * @param common - Common instance
   * @param prefix - Contract prefix name
   * @param args - Contract constructor args
   * @param clearup - Clear up contract storage before deploy
   */
  private static async deployContract(evm: EVM, common: Common, prefix: string, args?: { types: string[]; values: any[] }, clearup?: boolean) {
    const code = hexStringToBuffer(common.param('vm', `${prefix}code`));
    const address = Address.fromString(common.param('vm', `${prefix}addr`));

    if (clearup) {
      await evm._state.clearContractStorage(address);
    }

    return await Contract.executeMessage(
      evm,
      new Message({
        contractAddress: address,
        to: address,
        gasLimit: MAX_INTEGER,
        data: args ? Buffer.concat([code, encode(args.types, args.values)]) : code
      })
    );
  }

  private static async executeMessage(evm: EVM, message: Message) {
    const {
      execResult: { logs, returnValue, exceptionError }
    } = await evm.executeMessage(message);
    if (exceptionError) {
      throw exceptionError;
    }
    return { logs, returnValue };
  }

  // make a call message
  protected makeCallMessage(method: string, types: string[], values: any[]) {
    return new Message({
      caller: EMPTY_ADDRESS,
      to: this.address,
      gasLimit: MAX_INTEGER,
      data: Buffer.concat([this.methods[method], encode(types, values)])
    });
  }

  // make a system call message
  protected makeSystemCallerMessage(method: string, types: string[], values: any[], amount?: BN) {
    return new Message({
      caller: Address.fromString(this.common.param('vm', 'scaddr')),
      to: this.address,
      gasLimit: MAX_INTEGER,
      value: amount,
      data: Buffer.concat([this.methods[method], encode(types, values)])
    });
  }

  // execute a message, throw a error if `exceptionError` is not undefined
  protected executeMessage(message: Message) {
    return Contract.executeMessage(this.evm, message);
  }

  // make sure it will output the error message
  protected async runWithLogger<T>(func: () => Promise<T>) {
    try {
      return await func();
    } catch (err) {
      logger.error('Contract::runWithLogger, catch error:', err);
      throw err;
    }
  }
}
