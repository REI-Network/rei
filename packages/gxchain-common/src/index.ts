import EthereumCommon from '@ethereumjs/common';
import { BNLike } from 'ethereumjs-util';
import * as constants from './constants';

export class Common extends EthereumCommon {
  static createCommonByBlockNumber(num: BNLike, genesisJSON: any) {
    const common = new Common({
      chain: genesisJSON.genesisInfo,
      hardfork: 'chainstart'
    });
    common.setHardforkByBlockNumber(num);
    return common;
  }
}

export * from './genesis';
export { constants };
