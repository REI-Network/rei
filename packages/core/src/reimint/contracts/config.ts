import { Address, BN, toBuffer } from 'ethereumjs-util';
import EVM from '@rei-network/vm/dist/evm/evm';
import { Common } from '@rei-network/common';
import { Contract } from './contract';

const methods = {
  maxValidatorsCount: toBuffer('0xf589b79e'),
  minValidatorsCount: toBuffer('0x5afa30ee'),
  minTotalLockedAmount: toBuffer('0xf656481e'),
  minerReward: toBuffer('0xcbed45eb'),
  dailyFee: toBuffer('0x9306fd3d'),
  minerRewardFactor: toBuffer('0x2a0453be')
};

export class Config extends Contract {
  constructor(evm: EVM, common: Common) {
    super(evm, common, methods, Address.fromString(common.param('vm', 'cfgaddr')));
  }

  maxValidatorsCount() {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('maxValidatorsCount', [], []));
      return new BN(returnValue);
    });
  }

  minValidatorsCount() {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('minValidatorsCount', [], []));
      return new BN(returnValue);
    });
  }

  minTotalLockedAmount() {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('minTotalLockedAmount', [], []));
      return new BN(returnValue);
    });
  }

  minerReward() {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('minerReward', [], []));
      return new BN(returnValue);
    });
  }

  dailyFee() {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('dailyFee', [], []));
      return new BN(returnValue);
    });
  }

  minerRewardFactor() {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('minerRewardFactor', [], []));
      return new BN(returnValue);
    });
  }
}
