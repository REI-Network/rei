import EVM from '@rei-network/vm/dist/evm/evm';
import { Address, BN, toBuffer } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { Contract } from './contract';

// function selector of stake manager
const methods = {
  distribute: toBuffer('0xfb932108')
};

// a class used to interact with the fee pool contract
export class FeePool extends Contract {
  constructor(evm: EVM, common: Common) {
    super(evm, common, methods, Address.fromString(common.param('vm', 'fpaddr')));
  }

  /**
   * Distribute block reward
   * @param validator - Miner address
   * @param amount - Shares earned by miner
   * @param value - Fee pool reward(Block reward * (1 - minerRewardFactor)) + Tx fee
   * @returns
   */
  distribute(validator: Address, amount: BN, value: BN) {
    return this.runWithLogger(async () => {
      const { logs } = await this.executeMessage(this.makeSystemCallerMessage('distribute', ['address', 'uint256'], [validator.toString(), amount.toString()], value));
      return logs;
    });
  }
}
