import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import { Common } from '@gxchain2/common';

export abstract class Contract {
  evm: EVM;
  common: Common;

  constructor(evm: EVM, common: Common) {
    this.evm = evm;
    this.common = common;
  }

  async deploy() {}
}
