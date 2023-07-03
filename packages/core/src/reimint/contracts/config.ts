import { Address, BN, toBuffer } from 'ethereumjs-util';
import EVM from '@rei-network/vm/dist/evm/evm';
import { Common } from '@rei-network/common';
import { Contract } from './contract';
import { bufferToAddress } from './utils';

const methods = {
  maxValidatorsCount: toBuffer('0xf589b79e'),
  minValidatorsCount: toBuffer('0x5afa30ee'),
  minTotalLockedAmount: toBuffer('0xf656481e'),
  minerReward: toBuffer('0xcbed45eb'),
  dailyFee: toBuffer('0x9306fd3d'),
  minerRewardFactor: toBuffer('0x2a0453be'),
  owner: toBuffer('0x8da5cb5b')
};

export class Config extends Contract {
  constructor(evm: EVM, common: Common) {
    super(evm, common, methods, Address.fromString(common.param('vm', 'cfgaddr')));
  }

  /**
   * Get max validators count
   */
  maxValidatorsCount() {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('maxValidatorsCount', [], []));
      return new BN(returnValue);
    });
  }

  /**
   * Get min validators count
   */
  minValidatorsCount() {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('minValidatorsCount', [], []));
      return new BN(returnValue);
    });
  }

  /**
   * Get min total lock amount
   */
  minTotalLockedAmount() {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('minTotalLockedAmount', [], []));
      return new BN(returnValue);
    });
  }

  /**
   * Get miner reward
   */
  minerReward() {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('minerReward', [], []));
      return new BN(returnValue);
    });
  }

  /**
   * Get daily fee
   */
  dailyFee() {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('dailyFee', [], []));
      return new BN(returnValue);
    });
  }

  /**
   * Get miner reward factor
   */
  minerRewardFactor() {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('minerRewardFactor', [], []));
      return new BN(returnValue);
    });
  }

  /**
   * Get owner address
   */
  owner() {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('owner', [], []));
      return bufferToAddress(returnValue);
    });
  }
}
