import { Address, BN } from 'ethereumjs-util';
import EVM from '@rei-network/vm/dist/evm/evm';
import Message from '@rei-network/vm/dist/evm/message';
import { Common } from '@rei-network/common';
import { hexStringToBuffer, logger } from '@rei-network/utils';
import { isEnableBetterPOS } from '../../hardforks';
import { EMPTY_ADDRESS } from '../../utils';
import { ActiveValidatorSet, genesisValidatorPriority } from '../validatorSet';
import { encode, validatorsEncode } from './utils';

const MAX_GAS_LIMIT = new BN('9223372036854775807');

export abstract class Contract {
  evm: EVM;
  common: Common;
  methods: { [name: string]: Buffer };
  address: Address;

  constructor(
    evm: EVM,
    common: Common,
    methods: { [name: string]: Buffer },
    address: Address
  ) {
    this.evm = evm;
    this.common = common;
    this.methods = methods;
    this.address = address;
  }

  static async deployHardforkValInfosContract(evm: EVM, common: Common) {
    await Contract.deployContract(evm, common, 'sm');
  }

  /**
   * Deploy reimint contracts
   * @param evm - EVM instance
   * @param common - Common instance
   */
  static async deployReimintContracts(evm: EVM, common: Common) {
    // NOTE: there is no need to care whether the bls contract exists
    const genesisValidators = await ActiveValidatorSet.genesis(common);
    const proposer = genesisValidators.proposer.toString();
    const activeValidators = genesisValidators.activeValidators();
    const activeSigners = activeValidators.map(({ validator }) =>
      validator.toString()
    );
    const cfgaddr = common.param('vm', 'cfgaddr');

    // deploy config contract
    await Contract.deployContract(evm, common, 'cfg');
    // deploy stake manager contract
    if (isEnableBetterPOS(common)) {
      const encoded = validatorsEncode(
        activeValidators.map((_, index) => new BN(index)),
        activeValidators.map(() => genesisValidatorPriority.clone())
      );
      await Contract.deployContract(evm, common, 'sm', {
        types: ['address', 'address', 'address[]', 'bytes'],
        values: [cfgaddr, proposer, activeSigners, encoded]
      });
    } else {
      const priorities = activeValidators.map(({ priority }) =>
        priority.toString()
      );
      await Contract.deployContract(evm, common, 'sm', {
        types: ['address', 'address', 'address[]', 'int256[]'],
        values: [cfgaddr, proposer, activeSigners, priorities]
      });
    }

    const defaultArgs = { types: ['address'], values: [cfgaddr] };
    // deploy unstake pool contract
    await Contract.deployContract(evm, common, 'up', defaultArgs);
    // deploy validator reward pool contract
    await Contract.deployContract(evm, common, 'vrp', defaultArgs);
  }

  /**
   * Deploy free staking contracts
   * @param evm - EVM instance
   * @param common - Common instance
   */
  static async deployFreeStakingContracts(evm: EVM, common: Common) {
    const cfgaddr = common.param('vm', 'cfgaddr');
    // deploy fee contract
    await Contract.deployContract(evm, common, 'f', {
      types: ['address'],
      values: [cfgaddr]
    });
    // deploy fee pool contract
    await Contract.deployContract(evm, common, 'fp', {
      types: ['address'],
      values: [cfgaddr]
    });
    // deploy fee token contract
    await Contract.deployContract(evm, common, 'ft', {
      types: ['address'],
      values: [cfgaddr]
    });
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
   * Deploy hardfork 2 contracts
   * @param evm - EVM instance
   * @param common - Common instance
   */
  static async deployHardfork2Contracts(evm: EVM, common: Common) {
    // deploy config contract
    await Contract.deployContract(evm, common, 'cfg', undefined, true);
    // deploy stake manager contract
    await Contract.deployContract(evm, common, 'sm');
  }

  /**
   * Deploy hardfork 3 contracts
   * @param evm - EVM instance
   * @param common - Common instance
   */
  static async deployHardfork3Contracts(evm: EVM, common: Common) {
    // deploy config contract
    await Contract.deployContract(evm, common, 'cfg', undefined, true);
    // upgrade stake manager contract
    await Contract.deployContract(evm, common, 'sm');
    // upgrade validator reward pool contract
    await Contract.deployContract(evm, common, 'vrp');
  }

  /**
   * Deploy better POS hardfork contracts
   * @param evm - EVM instance
   * @param common - Common instance
   */
  static async deployBetterPOSContracts(evm: EVM, common: Common) {
    const cfgaddr = common.param('vm', 'cfgaddr');
    // deploy prison contract
    await Contract.deployContract(evm, common, 'pr', {
      types: ['address'],
      values: [cfgaddr]
    });
  }

  /**
   * Deploy DAO hardfork contracts
   * @param evm - EVM instance
   * @param common - Common instance
   */
  static async deloyDAOContracts(evm: EVM, common: Common) {
    await Contract.deployContract(evm, common, 'fallback', undefined, true);
  }

  /**
   * Deploy contract to target address
   * @param evm - EVM instance
   * @param common - Common instance
   * @param prefix - Contract prefix name
   * @param args - Contract constructor args
   * @param clearup - Clear up contract storage before deploy
   */
  private static async deployContract(
    evm: EVM,
    common: Common,
    prefix: string,
    args?: { types: string[]; values: any[] },
    clearup?: boolean
  ) {
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
        gasLimit: MAX_GAS_LIMIT,
        data: args
          ? Buffer.concat([code, encode(args.types, args.values)])
          : code
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
      gasLimit: MAX_GAS_LIMIT,
      isStatic: true,
      data: Buffer.concat([this.methods[method], encode(types, values)])
    });
  }

  // make a system call message
  protected makeSystemCallerMessage(
    method: string,
    types: string[],
    values: any[],
    amount?: BN
  ) {
    return new Message({
      caller: Address.fromString(this.common.param('vm', 'scaddr')),
      to: this.address,
      gasLimit: MAX_GAS_LIMIT,
      value: amount,
      isStatic: false,
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
