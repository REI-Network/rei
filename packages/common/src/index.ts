import './install';
import EthereumCommon from '@ethereumjs/common';
import { BNLike } from 'ethereumjs-util';
import { getChain } from './chains';

/**
 * Common class to access chain and hardfork parameters, based on 'EthereumCommon'
 */
export class Common extends EthereumCommon {
  /**
   * Static method to create a Common object based on 'EthereumCommon'
   * @param chain The name (`mainnet`) or id (`1`)  or a object of a standard chain used to base the custom
   * chain params on.
   * @returns Common objcet
   */
  static createChainStartCommon(chain: number | string | Object) {
    const common = new Common({
      chain: typeof chain === 'object' ? chain : getChain(chain),
      hardfork: 'chainstart'
    });
    return common;
  }

  /**
   * Static method to create a Common object and sets a new hardfork based on the block number provided
   * @param num block number
   * @param chain The name (`mainnet`) or id (`1`)  or a object of a standard chain used to base the custom
   * chain params on.
   * @returns Common objcet
   */
  static createCommonByBlockNumber(num: BNLike, chain: number | string | Object) {
    const common = new Common({
      chain: typeof chain === 'object' ? chain : getChain(chain),
      hardfork: 'chainstart'
    });
    common.setHardforkByBlockNumber(num);
    return common;
  }
}

export * from './genesisStates';
export * from './chains';
