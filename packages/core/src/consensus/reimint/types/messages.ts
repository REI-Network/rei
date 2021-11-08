import { rlp, BN, bnToUnpaddedBuffer, intToBuffer, bufferToInt } from 'ethereumjs-util';
import { Block, BlockBuffer, BlockOptions } from '@gxchain2/structure';
import { RoundStepType } from './roundStepType';
import { Proposal } from './proposal';
import { BitArray, BitArrayRaw } from './bitArray';
import { Vote, VoteType } from './vote';
import * as v from './validate';

export interface Message {
  raw(): any;
  serialize(): Buffer;
  validateBasic(): void;
}

export class NewRoundStepMessage implements Message {
  readonly height: BN;
  readonly round: number;
  readonly step: RoundStepType;

  constructor(height: BN, round: number, step: RoundStepType) {
    this.height = height.clone();
    this.round = round;
    this.step = step;
    this.validateBasic();
  }

  static fromValuesArray(values: Buffer[]) {
    if (values.length !== 3) {
      throw new Error('invalid values');
    }

    const [heightBuffer, roundBuffer, stepBuffer] = values;
    return new NewRoundStepMessage(new BN(heightBuffer), bufferToInt(roundBuffer), bufferToInt(stepBuffer));
  }

  raw() {
    return [bnToUnpaddedBuffer(this.height), intToBuffer(this.round), intToBuffer(this.step)];
  }

  serialize() {
    return rlp.encode(this.raw());
  }

  validateBasic() {
    v.validateHeight(this.height);
    v.validateRound(this.round);
    v.validateStep(this.step);
  }
}

export class NewValidBlockMessage implements Message {
  readonly height: BN;
  readonly round: number;
  readonly hash: Buffer;
  readonly isCommit: boolean;

  constructor(height: BN, round: number, hash: Buffer, isCommit: boolean) {
    this.height = height.clone();
    this.round = round;
    this.hash = hash;
    this.isCommit = isCommit;
    this.validateBasic();
  }

  static fromValuesArray(values: Buffer[]) {
    if (values.length !== 4) {
      throw new Error('invalid values');
    }

    const [heightBuffer, roundBuffer, hash, isCommitBuffer] = values;
    const numIsCommit = bufferToInt(isCommitBuffer);
    if (numIsCommit !== 0 && numIsCommit !== 1) {
      throw new Error('invalid isCommit');
    }
    return new NewValidBlockMessage(new BN(heightBuffer), bufferToInt(roundBuffer), hash, numIsCommit === 1);
  }

  raw() {
    return [bnToUnpaddedBuffer(this.height), intToBuffer(this.round), this.hash, intToBuffer(this.isCommit ? 1 : 0)];
  }

  serialize() {
    return rlp.encode(this.raw());
  }

  validateBasic() {
    v.validateHeight(this.height);
    v.validateRound(this.round);
    v.validateHash(this.hash);
  }
}

export class ProposalMessage implements Message {
  readonly proposal: Proposal;

  constructor(proposal: Proposal) {
    this.proposal = proposal;
    this.validateBasic();
  }

  static fromValuesArray(values: Buffer[]) {
    return new ProposalMessage(Proposal.fromValuesArray(values));
  }

  raw() {
    return this.proposal.raw();
  }

  serialize() {
    return this.proposal.serialize();
  }

  validateBasic() {
    if (!this.proposal.isSigned()) {
      throw new Error('invalid proposal');
    }
  }
}

export class ProposalPOLMessage implements Message {
  readonly height: BN;
  readonly proposalPOLRound: number;
  readonly proposalPOL: BitArray;

  constructor(height: BN, proposalPOLRound: number, proposalPOL: BitArray) {
    this.height = height.clone();
    this.proposalPOLRound = proposalPOLRound;
    this.proposalPOL = proposalPOL;
    this.validateBasic();
  }

  static fromValuesArray(values: (Buffer | BitArrayRaw)[]) {
    if (values.length !== 3) {
      throw new Error('invalid values');
    }

    const [heightBuffer, proposalPOLRoundBuffer, proposalPOLBuffer] = values;
    if (!(heightBuffer instanceof Buffer) || !(proposalPOLRoundBuffer instanceof Buffer) || proposalPOLBuffer instanceof Buffer || !Array.isArray(proposalPOLBuffer)) {
      throw new Error('invalid values');
    }
    return new ProposalPOLMessage(new BN(heightBuffer), bufferToInt(proposalPOLRoundBuffer), BitArray.fromValuesArray(proposalPOLBuffer));
  }

  raw() {
    return [bnToUnpaddedBuffer(this.height), intToBuffer(this.proposalPOLRound), this.proposalPOL.raw()];
  }

  serialize() {
    return rlp.encode(this.raw());
  }

  validateBasic() {
    v.validateHeight(this.height);
    if (this.proposalPOLRound !== -1) {
      v.validateRound(this.proposalPOLRound);
    }
  }
}

export class ProposalBlockMessage implements Message {
  readonly block: Block;

  constructor(block: Block) {
    this.block = block;
    this.validateBasic();
  }

  static fromValuesArray(values: BlockBuffer, options?: BlockOptions) {
    return new ProposalBlockMessage(Block.fromValuesArray(values, options));
  }

  raw() {
    return this.block.raw();
  }

  serialize() {
    return this.block.serialize();
  }

  validateBasic() {
    // no thing
  }
}

export class VoteMessage implements Message {
  readonly vote: Vote;

  constructor(vote: Vote) {
    this.vote = vote;
    this.validateBasic();
  }

  static fromValuesArray(values: Buffer[]) {
    return new VoteMessage(Vote.fromValuesArray(values));
  }

  raw() {
    return this.vote.raw();
  }

  serialize() {
    return this.vote.serialize();
  }

  validateBasic() {
    if (!this.vote.isSigned()) {
      throw new Error('invalid vote');
    }
  }
}

export class HasVoteMessage implements Message {
  readonly height: BN;
  readonly round: number;
  readonly type: VoteType;
  readonly index: number;

  constructor(height: BN, round: number, type: VoteType, index: number) {
    this.height = height.clone();
    this.round = round;
    this.type = type;
    this.index = index;
    this.validateBasic();
  }

  static fromValuesArray(values: Buffer[]) {
    if (values.length !== 4) {
      throw new Error('invalid values');
    }

    const [heightBuffer, roundBuffer, typeBuffer, indexBuffer] = values;
    return new HasVoteMessage(new BN(heightBuffer), bufferToInt(roundBuffer), bufferToInt(typeBuffer), bufferToInt(indexBuffer));
  }

  raw() {
    return [bnToUnpaddedBuffer(this.height), intToBuffer(this.round), intToBuffer(this.type), intToBuffer(this.index)];
  }

  serialize() {
    return rlp.encode(this.raw());
  }

  validateBasic() {
    v.validateVoteType(this.type);
    v.validateHeight(this.height);
    v.validateRound(this.round);
    v.validateIndex(this.index);
  }
}

export class VoteSetMaj23Message implements Message {
  readonly height: BN;
  readonly round: number;
  readonly type: VoteType;
  readonly hash: Buffer;

  constructor(height: BN, round: number, type: VoteType, hash: Buffer) {
    this.height = height.clone();
    this.round = round;
    this.type = type;
    this.hash = hash;
    this.validateBasic();
  }

  static fromValuesArray(values: Buffer[]) {
    if (values.length !== 4) {
      throw new Error('invalid values');
    }

    const [heightBuffer, roundBuffer, typeBuffer, hash] = values;
    return new VoteSetMaj23Message(new BN(heightBuffer), bufferToInt(roundBuffer), bufferToInt(typeBuffer), hash);
  }

  raw() {
    return [bnToUnpaddedBuffer(this.height), intToBuffer(this.round), intToBuffer(this.type), this.hash];
  }

  serialize() {
    return rlp.encode(this.raw());
  }

  validateBasic() {
    v.validateVoteType(this.type);
    v.validateHeight(this.height);
    v.validateRound(this.round);
    v.validateHash(this.hash);
  }
}

export class VoteSetBitsMessage implements Message {
  readonly height: BN;
  readonly round: number;
  readonly type: VoteType;
  readonly hash: Buffer;
  readonly votes: BitArray;

  constructor(height: BN, round: number, type: VoteType, hash: Buffer, votes: BitArray) {
    this.height = height.clone();
    this.round = round;
    this.type = type;
    this.hash = hash;
    this.votes = votes;
    this.validateBasic();
  }

  static fromValuesArray(values: Buffer[]) {
    if (values.length !== 5) {
      throw new Error('invalid values');
    }

    const [heightBuffer, roundBuffer, typeBuffer, hash, votesBuffer] = values;
    if (!Array.isArray(votesBuffer)) {
      throw new Error('invalid votes values length');
    }
    return new VoteSetBitsMessage(new BN(heightBuffer), bufferToInt(roundBuffer), bufferToInt(typeBuffer), hash, BitArray.fromValuesArray(votesBuffer));
  }

  raw() {
    return [bnToUnpaddedBuffer(this.height), intToBuffer(this.round), intToBuffer(this.type), this.hash, this.votes.raw()];
  }

  serialize() {
    return rlp.encode(this.raw());
  }

  validateBasic() {
    v.validateVoteType(this.type);
    v.validateHeight(this.height);
    v.validateRound(this.round);
    v.validateHash(this.hash);
  }
}

export class GetProposalBlockMessage implements Message {
  readonly hash: Buffer;

  constructor(hash: Buffer) {
    this.hash = hash;
    this.validateBasic();
  }

  static fromValuesArray(values: Buffer[]) {
    if (values.length !== 1) {
      throw new Error('invalid values');
    }

    const [hash] = values;
    return new GetProposalBlockMessage(hash);
  }

  raw() {
    return [this.hash];
  }

  serialize() {
    return rlp.encode(this.raw());
  }

  validateBasic() {
    v.validateHash(this.hash);
  }
}
