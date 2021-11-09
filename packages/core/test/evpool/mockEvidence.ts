import { BN, keccak256, rlp, bnToUnpaddedBuffer } from 'ethereumjs-util';
import { Evidence, EvidenceFactory } from '../../src/consensus/reimint/types';

export class MockEvidence implements Evidence {
  readonly height: BN;

  constructor(height: BN) {
    this.height = height.clone();
    this.validateBasic();
  }

  static readonly code = 100;

  static fromValuesArray(values: Buffer[]) {
    if (values.length !== 1) {
      throw new Error('invalid evidence values');
    }

    const [heightBuf] = values;
    if (!(heightBuf instanceof Buffer)) {
      throw new Error('invalid evidence values');
    }

    return new MockEvidence(new BN(heightBuf));
  }

  verify() {}

  hash(): Buffer {
    return keccak256(this.height.toBuffer());
  }

  raw() {
    return [bnToUnpaddedBuffer(this.height)];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {
    // do nothing
  }
}

EvidenceFactory.registry.register(MockEvidence);
