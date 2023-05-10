import { Address, toBuffer } from 'ethereumjs-util';
import EVM from '@rei-network/vm/dist/evm/evm';
import { Common } from '@rei-network/common';
import { Receipt } from '@rei-network/structure';
import { ValidatorChanges } from '../validatorSet';
import { Contract } from './contract';
import { decodeBytes, bufferToAddress } from './utils';

const methods = {
  getBLSPublicKey: toBuffer('0xc2e7cbdd')
};

const event = {
  SetBLSPublicKey: toBuffer('0x4861c1796b9ac9313a6c9d77539ee86af148464a0b9bfd9e7bcd50baae5ca9b2')
};

export class ValidatorBLS extends Contract {
  constructor(evm: EVM, common: Common) {
    super(evm, common, methods, Address.fromString(common.param('vm', 'postaddr')));
  }

  /**
   * Filter validator bls public key changes from receipts
   * @param changes - Validator changes
   * @param receipts - Receipts
   * @param common - Common instance
   */
  static filterReceiptsChanges(changes: ValidatorChanges, receipts: Receipt[], common: Common) {
    const blsAddr = Address.fromString(common.param('vm', 'postaddr'));
    for (const receipt of receipts) {
      if (receipt.logs.length > 0) {
        for (const log of receipt.logs) {
          if (log.address.equals(blsAddr.buf) && log.topics.length === 2 && log.topics[0].equals(event['SetBLSPublicKey'])) {
            //get validator address and bls public key
            changes.setBlsPublicKey(bufferToAddress(log.topics[1]), log.data.slice(64, 112));
          }
        }
      }
    }
  }

  /**
   * Get validator bls public key
   * @param validator - Validator address
   * @returns - BLS public key
   */
  async getBLSPublicKey(validator: Address) {
    return this.runWithLogger(async () => {
      const { returnValue } = await this.executeMessage(this.makeCallMessage('getBLSPublicKey', ['address'], [validator.toString()]));
      const pk = toBuffer(decodeBytes(returnValue));
      return pk.length === 0 ? undefined : pk;
    });
  }
}
