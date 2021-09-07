import './install';
import EthereumCommon from '@gxchain2-ethereumjs/common';
import { BNLike } from 'ethereumjs-util';
import { getChain } from './chains';

export * from './genesisStates';
export * from './chains';
export { ConsensusAlgorithm, ConsensusType } from '@gxchain2-ethereumjs/common';

/**
 * Common class to access chain and hardfork parameters, based on `@ethereumjs/common`
 */
export class Common extends EthereumCommon {
  /**
   * Static method to create a Common object with `chainstart` hardfork
   * @param chain - Chain name (`gxc2-mainnet`) or chain id (`1`)  or a standard chain object with chain params
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
   * Static method to create a Common object and set hardfork by block number
   * @param num - Block number
   * @param chain - Chain name (`gxc2-mainnet`) or chain id (`1`)  or a standard chain object with chain params
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

  // consensusType will never change, we just read directly from `_chainParams`
  consensusType() {
    return (this as any)._chainParams['consensus']['type'];
  }

  // consensusAlgorithm will never change, we just read directly from `_chainParams`
  consensusAlgorithm() {
    return (this as any)._chainParams['consensus']['algorithm'];
  }

  // consensusConfig will never change, we just read directly from `_chainParams`
  consensusConfig() {
    return (this as any)._chainParams['consensus'][this.consensusAlgorithm()];
  }
}
