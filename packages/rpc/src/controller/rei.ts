import { bnToHex, Address, BN, intToHex } from 'ethereumjs-util';
import { hexStringToBN } from '@rei-network/utils';
import { StateManager } from '../types';
import { Controller } from './base';

export class ReiController extends Controller {
  /**
   * Estimate user available fee
   * @param address - Target address
   * @param tag - Block tag
   * @returns Estimate result
   */
  async rei_estimateFee([address, tag]: [string, string]) {
    const block = await this.getBlockByTag(tag);
    const common = block._common;
    const strDailyFee = common.param('vm', 'dailyFee');
    if (typeof strDailyFee !== 'string') {
      return null;
    }

    const vm = await this.backend.getVM(block.header.stateRoot, common);
    const fee = this.backend.reimint.getFee(vm, block, common);

    const totalAmount: BN = await fee.totalAmount();
    const timestamp = block.header.timestamp.toNumber();
    const dailyFee = hexStringToBN(strDailyFee);

    const account = await (vm.stateManager as StateManager).getAccount(Address.fromString(address));
    const stakeInfo = account.getStakeInfo();
    return bnToHex(stakeInfo.estimateFee(timestamp, totalAmount, dailyFee));
  }

  /**
   * Get the total deposit amount of the user
   * @param address - Target address
   * @param tag - Block tag
   * @returns Total deposit amount
   */
  async rei_getTotalAmount([address, tag]: [string, string]) {
    const stateManager = await this.getStateManagerByTag(tag);
    const account = await stateManager.getAccount(Address.fromString(address));
    const stakeInfo = account.getStakeInfo();
    return bnToHex(stakeInfo.total);
  }

  /**
   * Read "dailyFee" settings from common
   * @param tag - Block tag
   * @returns Daily fee
   */
  async rei_getDailyFee([tag]: [string]) {
    const num = await this.getBlockNumberByTag(tag);
    const common = this.backend.getCommon(num);
    const strDailyFee = common.param('vm', 'dailyFee');
    if (typeof strDailyFee !== 'string') {
      return null;
    }
    return hexStringToBN(strDailyFee);
  }

  /**
   * Read "minerRewardFactor" settings from common
   * @param tag - Block tag
   * @returns Miner reward factor
   */
  async rei_getMinerRewardFactor([tag]: [string]) {
    const num = await this.getBlockNumberByTag(tag);
    const common = this.backend.getCommon(num);
    const factor = common.param('vm', 'minerRewardFactor');
    if (typeof factor !== 'number' || factor < 0 || factor > 100) {
      return null;
    }
    return intToHex(factor);
  }
}
