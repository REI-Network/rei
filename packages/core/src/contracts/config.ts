import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import Message from '@gxchain2-ethereumjs/vm/dist/evm/message';
import { Address, MAX_INTEGER } from 'ethereumjs-util';
import { Common } from '@gxchain2/common';
import { hexStringToBuffer } from '@gxchain2/utils';

// TODO: add methods
const methods = {};

export class Config {
  private evm!: EVM;
  private common!: Common;

  constructor(evm: EVM, common: Common) {
    this.evm = evm;
    this.common = common;
  }

  async deploy() {
    const cfgaddr = Address.fromString(this.common.param('vm', 'cfgaddr'));
    const result = await this.evm.executeMessage(
      new Message({
        contractAddress: cfgaddr,
        to: cfgaddr,
        gasLimit: MAX_INTEGER,
        // config code
        data: hexStringToBuffer(this.common.param('vm', 'cfgcode'))
      })
    );
    if (result.execResult.exceptionError) {
      throw result.execResult.exceptionError;
    }
  }
}
