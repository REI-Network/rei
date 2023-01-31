import { Address, toBuffer } from 'ethereumjs-util';
import EVM from '@rei-network/vm/dist/evm/evm';
import { Common } from '@rei-network/common';
import { Receipt } from '@rei-network/structure';
import { ValidatorChanges } from '../validatorSet';
import { Contract } from './contract';

const methods = {
  validators: toBuffer('0x35aa2e44'),
  validatorsLength: toBuffer('0xf1105a7e'),
  setBlsPublicKey: toBuffer('0xdd9e4222'),
  getBlsPublicKey: toBuffer('0x647e0e98'),
  isRegistered: toBuffer('0xc3c5a547'),
  blsPubkeyExist: toBuffer('0x90232a32')
};

const event = {
  SetBlsPublicKey: toBuffer('0x675abc7506819cff3ebcd1a0d961f09a373b8b5233bc2740c1f153fd4d79a980')
};

export class ValidatorBls extends Contract {
  constructor(evm: EVM, common: Common) {
    super(evm, common, methods, Address.fromString(common.param('vm', 'postBlsAddress')));
  }

  static filterReceiptsChanges(changes: ValidatorChanges, receipts: Receipt[], common: Common) {
    const blsAddr = Address.fromString(common.param('vm', 'postBlsAddress'));
    for (const receipt of receipts) {
      if (receipt.logs.length > 0) {
        for (const log of receipt.logs) {
          if (log.address.equals(blsAddr.buf) && log.topics.length === 3 && log.topics[0].equals(event['SetBlsPublicKey'])) {
            const validator = log.topics[1];
            const blsPublicKey = log.topics[2];
            changes.setBlsPublicKey(new Address(validator), blsPublicKey);
          }
        }
      }
    }
  }

  async isRegistered(address: Address) {
    return false;
  }

  async setBlsPublicKey(blsPublicKey: Buffer) {}

  async getBlsPublicKey(validator: Address) {
    return Buffer.alloc(0);
  }

  async validatorsLength() {
    return 0;
  }

  async validators(index: number) {
    return Address.zero();
  }

  async blsPubkeyExist(blsPublicKey: Buffer) {
    return false;
  }
}
