import { bnToHex, Address, intToHex, BN } from 'ethereumjs-util';
import { hexStringToBN } from '@rei-network/utils';
import { isEnableDAO } from '@rei-network/core';
import { Controller } from './base';

/**
 * Rei api Controller
 */
export class ReiController extends Controller {
  /**
   * Get client version
   * @returns Client version
   */
  getVersion() {
    return this.server.version;
  }

  /**
   * Estimate user available crude
   * @param address - Target address
   * @param tag - Block tag
   * @returns Available crude
   */
  async getCrude([address, tag]: [string, string]) {
    const block = await this.getBlockByTag(tag);
    const common = block._common;
    const state = await this.node.getStateManager(block.header.stateRoot, common);
    const faddr = Address.fromString(common.param('vm', 'faddr'));
    const totalAmount = (await state.getAccount(faddr)).balance;
    const timestamp = block.header.timestamp.toNumber();

    let dailyFee: BN | undefined = undefined;
    if (block.header.number.gten(1)) {
      const parent = await this.node.db.getHeader(block.header.parentHash, block.header.number.subn(1));
      const parentCommon = parent._common;
      if (isEnableDAO(parentCommon)) {
        // load dailyFee from contract
        const parentVM = await this.node.getVM(parent.stateRoot, parentCommon);
        const config = await this.node.reimint.getConfig(parentVM, block, parentCommon);
        dailyFee = await config.dailyFee();
      }
    }

    // load dailyFee from common
    if (dailyFee === undefined) {
      const strDailyFee = common.param('vm', 'dailyFee');
      if (typeof strDailyFee !== 'string') {
        return null;
      }
      dailyFee = hexStringToBN(strDailyFee);
    }

    const account = await state.getAccount(Address.fromString(address));
    const stakeInfo = account.getStakeInfo();
    return bnToHex(stakeInfo.estimateFee(timestamp, totalAmount, dailyFee));
  }

  /**
   * Estimate user used crude
   * @param address - Target address
   * @param tag - Block tag
   * @returns Used crude
   */
  async getUsedCrude([address, tag]: [string, string]) {
    const block = await this.getBlockByTag(tag);
    const timestamp = block.header.timestamp.toNumber();
    const state = await this.node.getStateManager(block.header.stateRoot, block._common);
    const account = await state.getAccount(Address.fromString(address));
    const stakeInfo = account.getStakeInfo();
    return bnToHex(stakeInfo.estimateUsage(timestamp));
  }

  /**
   * Get the total deposit amount of the user
   * @param address - Target address
   * @param tag - Block tag
   * @returns Total deposit amount
   */
  async getTotalAmount([address, tag]: [string, string]) {
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
  async getDailyFee([tag]: [string]) {
    const block = await this.getBlockByTag(tag);

    let dailyFee: BN | undefined = undefined;
    if (block.header.number.gten(1)) {
      const parent = await this.node.db.getHeader(block.header.parentHash, block.header.number.subn(1));
      const parentCommon = parent._common;
      if (isEnableDAO(parentCommon)) {
        // load dailyFee from contract
        const parentVM = await this.node.getVM(parent.stateRoot, parentCommon);
        const config = await this.node.reimint.getConfig(parentVM, block, parentCommon);
        dailyFee = await config.dailyFee();
      }
    }

    // load dailyFee from common
    if (dailyFee === undefined) {
      const strDailyFee = block._common.param('vm', 'dailyFee');
      if (typeof strDailyFee !== 'string') {
        return null;
      }
      dailyFee = hexStringToBN(strDailyFee);
    }

    return bnToHex(dailyFee);
  }

  /**
   * Read "minerRewardFactor" settings from common
   * @param tag - Block tag
   * @returns Miner reward factor
   */
  async getMinerRewardFactor([tag]: [string]) {
    const block = await this.getBlockByTag(tag);

    let factor: number | undefined = undefined;
    if (block.header.number.gten(1)) {
      const parent = await this.node.db.getHeader(block.header.parentHash, block.header.number.subn(1));
      const parentCommon = parent._common;
      if (isEnableDAO(parentCommon)) {
        // load minerRewardFactor from contract
        const parentVM = await this.node.getVM(parent.stateRoot, parentCommon);
        const config = await this.node.reimint.getConfig(parentVM, block, parentCommon);
        factor = (await config.minerRewardFactor()).toNumber();
      }
    }

    // load minerRewardFactor from common
    if (factor === undefined) {
      factor = block._common.param('vm', 'minerRewardFactor');
      if (typeof factor !== 'number' || factor < 0 || factor > 100) {
        return null;
      }
    }

    return intToHex(factor);
  }

  /**
   * Get miner info
   * @param tag - Block tag
   * @returns Miner info
   */
  async getMinerInfo([tag]: [string]) {
    const coinbase = this.node.reimint.coinbase.toString();
    const unlockAccount = this.node.accMngr.totalUnlockedAccounts();
    const unlockBLSPublicKey = this.node.blsMngr.getPublicKey();
    const block = await this.getBlockByTag(tag);
    const result: {
      coinbase: string;
      unlockAccount: string[];
      unlockBLSPublicKey: string | null;
      registerBLSPublicKey: string | null;
      version:string
    } = {
      coinbase,
      unlockAccount: unlockAccount.map((account) => account.toString('hex')),
      unlockBLSPublicKey: unlockBLSPublicKey?.toHex() ?? null,
      registerBLSPublicKey: null,
      version: this.server.version
    };
    if (!isEnableDAO(block._common)) {
      return result;
    }
    const vm = await this.node.getVM(block.header.stateRoot, block._common);
    const bls = this.node.reimint.getValidatorBLS(vm, block);
    const blsPublicKey = await bls.getBLSPublicKey(Address.fromString(coinbase));
    result.registerBLSPublicKey = blsPublicKey?.toString('hex') ?? null;
    return result;
  }
}
