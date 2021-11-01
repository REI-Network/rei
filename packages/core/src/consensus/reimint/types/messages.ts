import { BN } from 'ethereumjs-util';
import { Block } from '@gxchain2/structure';
import { RoundStepType } from '../state';
import { Proposal } from './proposal';
import { BitArray } from './bitArray';
import { Vote, VoteType } from './vote';
import * as v from './validate';

export interface Message {
  validateBasic(): void;
}

export class NewRoundStepMessage implements Message {
  readonly height: BN;
  readonly round: number;
  readonly step: RoundStepType;
  secondsSinceStartTime: number; // TODO
  lastCommitRound: number; // TODO

  constructor(height: BN, round: number, step: RoundStepType, secondsSinceStartTime: number, lastCommitRound: number) {
    this.height = height.clone();
    this.round = round;
    this.step = step;
    this.secondsSinceStartTime = secondsSinceStartTime;
    this.lastCommitRound = lastCommitRound;
    this.validateBasic();
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

  validateBasic() {
    v.validateHash(this.hash);
  }
}
