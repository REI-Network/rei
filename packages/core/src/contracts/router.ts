import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import { Address, BN, toBuffer } from 'ethereumjs-util';
import { Common } from '@gxchain2/common';
import { Contract } from './contract';

// function selector of router
const methods = {
  estimateTotalFee: toBuffer('0x15e8cc34'),
  assignTransactionReward: toBuffer('0xf49cd323'),
  assignBlockReward: toBuffer('0x0cccae70'),
  onAfterBlock: toBuffer('0xf4cfad16')
};

export class Router extends Contract {
  constructor(evm: EVM, common: Common) {
    super(evm, common, methods, Address.fromString(common.param('vm', 'raddr')));
  }

  async estimateTotalFee(user: Address, timestamp: number) {
    const { returnValue } = await this.executeMessage(this.makeCallMessage('estimateTotalFee', ['address', 'uint256'], [user.toString(), timestamp]));
    let i = 0;
    return {
      fee: new BN(returnValue.slice(i++ * 32, i * 32)),
      freeFee: new BN(returnValue.slice(i++ * 32, i * 32))
    };
  }

  async assignTransactionReward(validator: Address, user: Address, feeUsage: BN, freeFeeUsage: BN, amount: BN) {
    const { logs } = await this.executeMessage(this.makeSystemCallerMessage('assignTransactionReward', ['address', 'address', 'uint256', 'uint256'], [validator.toString(), user.toString(), feeUsage.toString(), freeFeeUsage.toString()], amount));
    return logs!;
  }

  async assignBlockReward(validator: Address, amount: BN) {
    const { logs } = await this.executeMessage(this.makeSystemCallerMessage('assignBlockReward', ['address'], [validator.toString()], amount));
    return logs;
  }

  async onAfterBlock(activeValidators: Address[], priorities: BN[]) {
    await this.executeMessage(this.makeSystemCallerMessage('onAfterBlock', ['address[]', 'int256[]'], [activeValidators.map((addr) => addr.toString()), priorities.map((p) => p.toString())]));
  }
}
