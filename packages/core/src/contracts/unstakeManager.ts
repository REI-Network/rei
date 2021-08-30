import Message from '@gxchain2-ethereumjs/vm/dist/evm/message';
import { Address, MAX_INTEGER } from 'ethereumjs-util';
import { hexStringToBuffer } from '@gxchain2/utils';
import { encode } from './utils';
import { Contract } from './contract';

export class UnstakeManager extends Contract {
  /**
   * Deploy unstake manager contract to `common.param('vm', 'usmaddr')`
   */
  async deploy() {
    const usmaddr = Address.fromString(this.common.param('vm', 'usmaddr'));
    const result = await this.evm.executeMessage(
      new Message({
        contractAddress: usmaddr,
        to: usmaddr,
        gasLimit: MAX_INTEGER,
        // unstake manager code
        data: Buffer.concat([hexStringToBuffer(this.common.param('vm', 'usmcode')), encode(['address'], [this.common.param('vm', 'cfgaddr')])])
      })
    );
    if (result.execResult.exceptionError) {
      throw result.execResult.exceptionError;
    }
  }
}
