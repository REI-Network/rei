import { rlp, bufferToInt, intToBuffer } from 'ethereumjs-util';
import { ContructorWithCode, Registry } from './registry';
import * as e from './evidence';
import { Evidence } from './evidence';

export interface EvidenceConstructor extends ContructorWithCode<Evidence> {
  fromValuesArray(values: any[]): Evidence;
}

export class EvidenceFactory {
  // disable constructor
  private constructor() {}

  static registry = new Registry<Evidence, EvidenceConstructor>();

  static fromSerializedEvidence(serialized: Buffer) {
    const data = rlp.decode(serialized);

    if (!Array.isArray(data)) {
      throw new Error('invalid serialized evidence');
    }

    return EvidenceFactory.fromValuesArray(data);
  }

  static fromValuesArray(values: any[]) {
    if (values.length < 2) {
      throw new Error('invalid evidence values');
    }

    const [codeBuffer, valuesArray] = values;
    if (!(codeBuffer instanceof Buffer) || !Array.isArray(valuesArray) || valuesArray.length === 0) {
      throw new Error('invalid evidence values');
    }

    return EvidenceFactory.registry.getCtorByCode(bufferToInt(codeBuffer)).fromValuesArray(valuesArray);
  }

  static serializeEvidence(ev: Evidence) {
    const code = EvidenceFactory.registry.getCodeByInstance(ev);
    return rlp.encode([intToBuffer(code), ev.raw()]);
  }
}

EvidenceFactory.registry.register(e.DuplicateVoteEvidence);
