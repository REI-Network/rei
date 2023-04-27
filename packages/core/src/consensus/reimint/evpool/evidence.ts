import { keccak256, rlp, BN } from 'ethereumjs-util';
import { ActiveValidatorSet } from '../validatorSet';
import { Vote, SignatureType } from '../vote';

export interface Evidence {
  height: BN;
  verify(...args: any[]): void;
  hash(): Buffer;
  raw(): any;
  serialize(): Buffer;
  validateBasic(): void;
}

export class DuplicateVoteEvidence implements Evidence {
  readonly voteA: Vote;
  readonly voteB: Vote;
  readonly height: BN;

  constructor(voteA: Vote, voteB: Vote) {
    this.height = voteA.height.clone();
    this.voteA = voteA;
    this.voteB = voteB;
    this.validateBasic();
  }

  static readonly code = 0;

  static sortVote(vote1: Vote, vote2: Vote): [Vote, Vote] {
    const num = vote1.hash.compare(vote2.hash);
    if (num === 0) {
      throw new Error('invalid votes(same hash)');
    }
    return [num > 0 ? vote2 : vote1, num > 0 ? vote1 : vote2];
  }

  static fromVotes(vote1: Vote, vote2: Vote) {
    return new DuplicateVoteEvidence(...DuplicateVoteEvidence.sortVote(vote1, vote2));
  }

  static fromValuesArray(values: Buffer[][]) {
    if (values.length !== 2) {
      throw new Error('invalid evidence values');
    }

    const [voteABuf, voteBBuf] = values;
    if (!Array.isArray(voteABuf) || !Array.isArray(voteBBuf)) {
      throw new Error('invalid evidence values');
    }

    return new DuplicateVoteEvidence(Vote.fromValuesArray(voteABuf), Vote.fromValuesArray(voteBBuf));
  }

  verify(valSet: ActiveValidatorSet) {
    const validator = valSet.getValidatorByIndex(this.voteA.index);
    if (!validator.equals(this.voteA.getValidator())) {
      throw new Error('invalid votes(validator index)');
    }
  }

  hash(): Buffer {
    return keccak256(this.serialize());
  }

  raw() {
    return [this.voteA.raw(), this.voteB.raw()];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {
    if (this.voteA.height.eqn(0)) {
      throw new Error('invalid votes(zero height)');
    }
    if (!this.voteA.isSigned() || !this.voteB.isSigned()) {
      throw new Error('invalid votes(unsigned)');
    }
    if (this.voteA.signatureType !== this.voteB.signatureType) {
      throw new Error('invalid votes(version)');
    }
    if (!this.voteA.height.eq(this.voteB.height) || this.voteA.round !== this.voteB.round || this.voteA.type !== this.voteB.type || this.voteA.chainId !== this.voteB.chainId || this.voteA.index !== this.voteB.index) {
      throw new Error('invalid votes(vote content)');
    }
    if (this.voteA.hash.equals(this.voteB.hash)) {
      throw new Error('invalid votes(same hash)');
    }
    if (!this.voteA.getValidator().equals(this.voteB.getValidator())) {
      throw new Error('invalid votes(unequal validator)');
    }
    const [voteA, voteB] = DuplicateVoteEvidence.sortVote(this.voteA, this.voteB);
    if (voteA !== this.voteA || voteB !== this.voteB) {
      throw new Error('invalid votes(sort)');
    }
  }
}
