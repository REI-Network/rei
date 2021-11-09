import { keccak256, rlp, BN } from 'ethereumjs-util';
import { Vote } from './vote';

export interface Evidence {
  height: BN;
  hash(): Buffer;
  raw(): any;
  serialize(): Buffer;
  validateBasic(): void;
}

function sortVote(vote1: Vote, vote2: Vote): [Vote, Vote] {
  if (!vote1.isSigned() || !vote2.isSigned()) {
    throw new Error('unsigned vote');
  }
  const num = vote1.signature!.compare(vote2.signature!);
  if (num === 0) {
    throw new Error('invalid equal votes');
  }
  return [num > 0 ? vote2 : vote1, num > 0 ? vote1 : vote2];
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

  static fromVotes(vote1: Vote, vote2: Vote) {
    return new DuplicateVoteEvidence(...sortVote(vote1, vote2));
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
    if (!this.voteA.height.eq(this.voteB.height) || this.voteA.round !== this.voteB.round || this.voteA.type !== this.voteB.type || this.voteA.chainId !== this.voteB.chainId || !this.voteA.hash.equals(this.voteB.hash) || this.voteA.index !== this.voteB.index) {
      throw new Error('invalid votes(vote content)');
    }
    if (!this.voteA.validator().equals(this.voteB.validator())) {
      throw new Error('invalid votes(unequal validator)');
    }
    if (this.voteA.signature!.equals(this.voteB.signature!)) {
      throw new Error('invalid votes(same signature)');
    }
    const [voteA, voteB] = sortVote(this.voteA, this.voteB);
    if (voteA !== this.voteA || voteB !== this.voteB) {
      throw new Error('invalid votes(sort)');
    }
  }
}
