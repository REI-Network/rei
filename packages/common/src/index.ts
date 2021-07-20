import './install';
import EthereumCommon from '@ethereumjs/common';
import { hardforks as EthereumHF } from '@ethereumjs/common/dist/hardforks';
import { BNLike } from 'ethereumjs-util';
import { getChain } from './chains';

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

  // ensure onlyActive is always true
  hardforkGteHardfork(
    hardfork1: string | null,
    hardfork2: string,
    opts?: {
      onlySupported?: boolean;
      onlyActive?: boolean;
    }
  ) {
    return super.hardforkGteHardfork(hardfork1, hardfork2, { ...opts, onlyActive: true });
  }

  /**
   * Returns the parameter corresponding to a hardfork
   * @param topic Parameter topic ('gasConfig', 'gasPrices', 'vm', 'pow')
   * @param name Parameter name (e.g. 'minGasLimit' for 'gasConfig' topic)
   * @param hardfork Hardfork name
   * @returns The value requested or `null` if not found
   */
  paramByHardfork(topic: string, name: string, hardfork: string): any {
    hardfork = this._chooseHardfork(hardfork);

    let value = null;
    for (const hfChanges of EthereumHF) {
      // hfChanges should be included in the chain hardforks
      if (this.hardforks().filter(({ name }) => name === hfChanges[0]).length > 0) {
        // EIP-referencing HF file (e.g. berlin.json)
        if (hfChanges[1].hasOwnProperty('eips')) {
          // eslint-disable-line
          const hfEIPs = hfChanges[1]['eips'];
          for (const eip of hfEIPs) {
            const valueEIP = this.paramByEIP(topic, name, eip);
            value = valueEIP !== null ? valueEIP : value;
          }
          // Paramater-inlining HF file (e.g. istanbul.json)
        } else {
          if (!hfChanges[1][topic]) {
            throw new Error(`Topic ${topic} not defined`);
          }
          if (hfChanges[1][topic][name] !== undefined) {
            value = hfChanges[1][topic][name].v;
          }
        }
      }
      if (hfChanges[0] === hardfork) break;
    }
    return value;
  }
}

export * from './genesisStates';
export * from './chains';
