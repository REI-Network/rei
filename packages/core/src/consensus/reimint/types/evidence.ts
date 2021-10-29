import { keccak256, rlp, BN, toBuffer } from 'ethereumjs-util';
import { Vote } from './vote';

export type EvidenceBuffer = DuplicateVoteEvidenceBuffer /* |  OtherEvidenceBuffer*/;

export interface Evidence {
  height: BN;
  hash(): Buffer;
  raw(): EvidenceBuffer;
  serialize(): Buffer;
  validateBasic(): void;
}

//////////////////////////////

export class EvidenceFactory {
  // disable constructor
  private constructor() {}

  static fromSerializedEvidence(serialized: Buffer) {
    const data = rlp.decode(serialized);

    if (!Array.isArray(data)) {
      throw new Error('invalid serialized evidence');
    }

    return EvidenceFactory.fromValuesArray(data);
  }

  static fromValuesArray(values: EvidenceBuffer) {
    if (values.length === 3) {
      return DuplicateVoteEvidence.fromValuesArray(values);
    } else {
      throw new Error('invalid evidence values');
    }
  }
}

//////////////////////////////

export type DuplicateVoteEvidenceBuffer = (Buffer | Buffer[])[];

export class DuplicateVoteEvidence implements Evidence {
  readonly voteA: Vote;
  readonly voteB: Vote;
  readonly height: BN;

  constructor(voteA: Vote, voteB: Vote, height: BN) {
    this.height = height.clone();
    this.voteA = voteA;
    this.voteB = voteB;
  }

  static fromValuesArray(values: DuplicateVoteEvidenceBuffer) {
    if (values.length !== 3) {
      throw new Error('invalid evidence values');
    }

    const [heightBuf, voteABuf, voteBBuf] = values;
    if (!(heightBuf instanceof Buffer)) {
      throw new Error('invalid evidence values');
    }

    if (!Array.isArray(voteABuf) || !Array.isArray(voteBBuf)) {
      throw new Error('invalid evidence values');
    }

    return new DuplicateVoteEvidence(Vote.fromValuesArray(voteABuf), Vote.fromValuesArray(voteBBuf), new BN(heightBuf));
  }

  hash(): Buffer {
    return keccak256(this.serialize());
  }

  raw(): DuplicateVoteEvidenceBuffer {
    return [toBuffer(this.height), this.voteA.raw(), this.voteB.raw()];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {
    // TODO:
  }
}
