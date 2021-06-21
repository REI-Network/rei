import './install';
import EthereumCommon from '@ethereumjs/common';
import { BNLike } from 'ethereumjs-util';
import { getChain } from './chains';

export class Common extends EthereumCommon {
  static createChainStartCommon(chain: number | string | Object) {
    const common = new Common({
      chain: typeof chain === 'object' ? chain : getChain(chain),
      hardfork: 'chainstart'
    });
    return common;
  }

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
