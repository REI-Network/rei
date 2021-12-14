import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import { Address, BN, toBuffer } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { Contract } from './contract';

// function selector of router
const methods = {
  assignBlockReward: toBuffer('0x0cccae70'),
  slash: toBuffer('0x30b409a4'),
  onAfterBlock: toBuffer('0x9313f105')
};

export enum SlashReason {
  DuplicateVote = 0
}

export class Router extends Contract {
  constructor(evm: EVM, common: Common) {
    super(evm, common, methods, Address.fromString(common.param('vm', 'raddr')));
  }

  assignBlockReward(validator: Address, amount: BN) {
    return this.runWithLogger(async () => {
      const { logs } = await this.executeMessage(this.makeSystemCallerMessage('assignBlockReward', ['address'], [validator.toString()], amount));
      return logs;
    });
  }

  slash(validator: Address, reason: SlashReason) {
    return this.runWithLogger(async () => {
      const { logs } = await this.executeMessage(this.makeSystemCallerMessage('slash', ['address', 'uint8'], [validator.toString(), reason]));
      return logs;
    });
  }

  onAfterBlock(proposer: Address, activeValidators: Address[], priorities: BN[]) {
    return this.runWithLogger(async () => {
      await this.executeMessage(this.makeSystemCallerMessage('onAfterBlock', ['address', 'address[]', 'int256[]'], [proposer.toString(), activeValidators.map((addr) => addr.toString()), priorities.map((p) => p.toString())]));
    });
  }
}
