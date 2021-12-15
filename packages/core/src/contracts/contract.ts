import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import { Address, BN, MAX_INTEGER } from 'ethereumjs-util';
import Message from '@gxchain2-ethereumjs/vm/dist/evm/message';
import { Common } from '@rei-network/common';
import { hexStringToBuffer, logger } from '@rei-network/utils';
import { EMPTY_ADDRESS } from '../utils';
import { ValidatorSet } from '../staking';
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

  static async deploy(evm: EVM, common: Common) {
    const genesisValidators = ValidatorSet.createGenesisValidatorSet(common);
    const activeValidators = genesisValidators.activeValidators();
    const activeSigners = activeValidators.map(({ validator }) => validator.toString());
    const priorities = activeValidators.map(({ priority }) => priority.toString());

    let cfgaddr!: string;
    const deploy = (prefix: string, args?: { types: string[]; values: any[] }) => {
      const code = hexStringToBuffer(common.param('vm', `${prefix}code`));
      const address = Address.fromString(common.param('vm', `${prefix}addr`));
      if (prefix === 'cfg') {
        cfgaddr = address.toString();
      }
      return Contract.executeMessage(
        evm,
        new Message({
          contractAddress: address,
          to: address,
          gasLimit: MAX_INTEGER,
          data: args ? Buffer.concat([code, encode(args.types, args.values)]) : code
        })
      );
    };

    // deploy config contract
    await deploy('cfg');
    // deploy stake manager contract
    await deploy('sm', { types: ['address', 'address', 'address[]', 'int256[]'], values: [cfgaddr, genesisValidators.proposer.toString(), activeSigners, priorities] });
    const defaultArgs = { types: ['address'], values: [cfgaddr] };
    // deploy unstake pool contract
    await deploy('up', defaultArgs);
    // deploy validator reward pool contract
    await deploy('vrp', defaultArgs);
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
