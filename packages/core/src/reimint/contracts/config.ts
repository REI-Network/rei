import { Address, BN, toBuffer } from 'ethereumjs-util';
import EVM from '@rei-network/vm/dist/evm/evm';
import { Common } from '@rei-network/common';
import { Log } from '@rei-network/structure';
import { Contract } from './contract';

const methods = {
  maxValidatorsCount: toBuffer('0xf589b79e'),
  minValidatorsCount: toBuffer('0x5afa30ee'),
  minTotalLockedAmount: toBuffer('0xf656481e'),
  minerReward: toBuffer('0xcbed45eb'),
  dailyFee: toBuffer('0x9306fd3d'),
  minerRewardFactor: toBuffer('0x2a0453be')
};

const events = {
  ConfigChange: toBuffer('0x2a57eb0dd1a628f5a906c7c36ef2073c97e608a56b67b9282f45e4f0644a0d84')
};

export type ConfigValues = {
  maxValidatorsCount: BN;
  minValidatorsCount: BN;
  minTotalLockedAmount: BN;
  minerReward: BN;
  dailyFee: BN;
  minerRewardFactor: BN;
};

export class Config extends Contract {
  constructor(evm: EVM, common: Common) {
    super(evm, common, methods, Address.fromString(common.param('vm', 'cfgaddr')));
  }

  filterLogsChanges(logs: Log[]) {
    const configAddress = Address.fromString(this.common.param('vm', 'cfgaddr'));
    for (const log of logs) {
      if (log.address.equals(configAddress.buf)) {
        if (log.topics.length === 1 && log.topics[0].equals(events['ConfigChange'])) {
          return true;
        }
      }
    }
    return false;
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

  async getConfigValue() {
    const configValues: ConfigValues = {
      maxValidatorsCount: await this.maxValidatorsCount(),
      minValidatorsCount: await this.minValidatorsCount(),
      minTotalLockedAmount: await this.minTotalLockedAmount(),
      minerReward: await this.minerReward(),
      dailyFee: await this.dailyFee(),
      minerRewardFactor: await this.minerRewardFactor()
    };
    return configValues;
  }
}
