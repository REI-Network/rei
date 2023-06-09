import { Address, BN, toBuffer } from 'ethereumjs-util';
import EVM from '@rei-network/vm/dist/evm/evm';
import { Common } from '@rei-network/common';
import { Receipt } from '@rei-network/structure';
import { ValidatorChanges } from '../validatorSet';
import { Contract } from './contract';
import { bufferToAddress } from './utils';
import { StateManager } from '../../stateManager/stateManager';
import { StorageLoader } from './storageLoader';

const methods = {
  getBlsPublicKey: toBuffer('0x647e0e98')
};

const event = {
  SetBlsPublicKey: toBuffer('0x675abc7506819cff3ebcd1a0d961f09a373b8b5233bc2740c1f153fd4d79a980')
};

export class ValidatorBls extends Contract {
  private storageLoader: StorageLoader;

  constructor(evm: EVM, common: Common) {
    super(evm, common, methods, Address.fromString(common.param('vm', 'postaddr')));
    this.storageLoader = new StorageLoader(evm._state as StateManager, Address.fromString(common.param('vm', 'postaddr')));
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
          if (log.address.equals(blsAddr.buf) && log.topics.length === 2 && log.topics[0].equals(event['SetBlsPublicKey'])) {
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
  async getBlsPublicKey(validator: Address) {
    return this.runWithLogger(async () => {
      const slot = StorageLoader.getMappingStorageIndex(StorageLoader.indexToSlotIndex(new BN(0)), toBuffer(validator.toString()));
      const pk = await this.storageLoader.loadBytesOrString(slot);
      return pk.length === 0 ? undefined : pk;
    });
  }
}
