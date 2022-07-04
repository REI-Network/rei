import EVM from '@rei-network/vm/dist/evm/evm';
import { Address, bufferToInt, intToBuffer, keccak256, setLengthLeft, toBuffer } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { StateManager } from '../../../stateManager';
import { Evidence } from '../evpool';
import { Contract } from './contract';

// function selector of Evidence storage
const methods = {
  addCommittedEvidence: toBuffer('0xa7849b6f')
};

// slots of Evidence storage
const slots = {
  evidence: setLengthLeft(intToBuffer(1), 32),
  evidenceList: setLengthLeft(intToBuffer(2), 32)
};

// TODO:
export class EvidenceStorage extends Contract {
  constructor(evm: EVM, common: Common) {
    super(evm, common, methods, Address.fromString(common.param('vm', 'esaddr')));
  }

  static async evidenceListLength(state: StateManager) {
    const address = Address.fromString(state._common.param('vm', 'esaddr'));
    return bufferToInt(await state.getContractStorage(address, slots.evidenceList));
  }

  static async isCommitedEvidence(ev: Evidence, state: StateManager) {
    const address = Address.fromString(state._common.param('vm', 'esaddr'));
    const buf = await state.getContractStorage(address, keccak256(Buffer.concat([ev.hash(), slots.evidence])));
    return buf.every((byte) => byte === 0);
  }

  addCommittedEvidence(evList: Evidence[]) {
    return this.runWithLogger(async () => {
      await this.evm.executeMessage(this.makeSystemCallerMessage('addCommittedEvidence', ['bytes[]'], [evList.map((ev) => ev.serialize())]));
    });
  }
}
