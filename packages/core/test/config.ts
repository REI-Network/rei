import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import { Common } from '@rei-network/common';
import { Address, toBuffer, BN } from 'ethereumjs-util';
import { Contract } from '../src/contracts';

// function selector
const methods = {
  dailyFee: toBuffer('0x9306fd3d'),
  dailyFreeFee: toBuffer('0x7ecdc0d2'),
  userFreeFeeLimit: toBuffer('0x44a62166')
};

export class Config extends Contract {
  constructor(evm: EVM, common: Common) {
    super(evm, common, methods, Address.fromString('0x0000000000000000000000000000000000001000'));
  }

  private simpleCall(name: string) {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage(name, [], []));
      return new BN(returnValue);
    });
  }

  dailyFee() {
    return this.simpleCall('dailyFee');
  }

  dailyFreeFee() {
    return this.simpleCall('dailyFreeFee');
  }

  userFreeFeeLimit() {
    return this.simpleCall('userFreeFeeLimit');
  }
}
