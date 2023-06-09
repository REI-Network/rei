import { Address, BN, toBuffer } from 'ethereumjs-util';
import EVM from '@rei-network/vm/dist/evm/evm';
import { Common } from '@rei-network/common';
import { Contract } from './contract';
import { StateManager } from '../../stateManager/stateManager';
import { StorageLoader } from './storageLoader';

const methods = {
  maxValidatorsCount: toBuffer('0xf589b79e'),
  minValidatorsCount: toBuffer('0x5afa30ee'),
  minTotalLockedAmount: toBuffer('0xf656481e'),
  minerReward: toBuffer('0xcbed45eb'),
  dailyFee: toBuffer('0x9306fd3d'),
  minerRewardFactor: toBuffer('0x2a0453be')
};

export class Config extends Contract {
  private storageLoader: StorageLoader;

  constructor(evm: EVM, common: Common) {
    super(evm, common, methods, Address.fromString(common.param('vm', 'cfgaddr')));
    this.storageLoader = new StorageLoader(evm._state as StateManager, Address.fromString(common.param('vm', 'cfgaddr')));
  }

  /**
   * Get max validators count
   */
  maxValidatorsCount() {
    return this.runWithLogger(async () => {
      const returnValue = await this.storageLoader.loadStorageSlot(StorageLoader.indexToSlotIndex(new BN(17)));
      return new BN(returnValue);
    });
  }

  /**
   * Get min validators count
   */
  minValidatorsCount() {
    return this.runWithLogger(async () => {
      const returnValue = await this.storageLoader.loadStorageSlot(StorageLoader.indexToSlotIndex(new BN(18)));
      return new BN(returnValue);
    });
  }

  /**
   * Get min total lock amount
   */
  minTotalLockedAmount() {
    return this.runWithLogger(async () => {
      const returnValue = await this.storageLoader.loadStorageSlot(StorageLoader.indexToSlotIndex(new BN(19)));
      return new BN(returnValue);
    });
  }

  /**
   * Get miner reward
   */
  minerReward() {
    return this.runWithLogger(async () => {
      const returnValue = await this.storageLoader.loadStorageSlot(StorageLoader.indexToSlotIndex(new BN(20)));
      return new BN(returnValue);
    });
  }

  /**
   * Get daily fee
   */
  dailyFee() {
    return this.runWithLogger(async () => {
      const returnValue = await this.storageLoader.loadStorageSlot(StorageLoader.indexToSlotIndex(new BN(21)));
      return new BN(returnValue);
    });
  }

  /**
   * Get miner reward factor
   */
  minerRewardFactor() {
    return this.runWithLogger(async () => {
      const returnValue = await this.storageLoader.loadStorageSlot(StorageLoader.indexToSlotIndex(new BN(22)));
      return new BN(returnValue);
    });
  }
}
