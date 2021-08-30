import Message from '@gxchain2-ethereumjs/vm/dist/evm/message';
import { Address, MAX_INTEGER } from 'ethereumjs-util';
import { hexStringToBuffer } from '@gxchain2/utils';
import { encode } from './utils';
import { Contract } from './contract';

export class ValidatorRewardManager extends Contract {
  /**
   * Deploy validator reward manager contract to `common.param('vm', 'vrmaddr')`
   */
  async deploy() {
    const vrmaddr = Address.fromString(this.common.param('vm', 'vrmaddr'));
    const result = await this.evm.executeMessage(
      new Message({
        contractAddress: vrmaddr,
        to: vrmaddr,
        gasLimit: MAX_INTEGER,
        // validator reward manager code
        data: Buffer.concat([hexStringToBuffer(this.common.param('vm', 'vrmcode')), encode(['address'], [this.common.param('vm', 'cfgaddr')])])
      })
    );
    if (result.execResult.exceptionError) {
      throw result.execResult.exceptionError;
    }
  }
}
