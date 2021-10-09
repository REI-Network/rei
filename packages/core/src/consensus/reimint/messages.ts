import { BN } from 'ethereumjs-util';
import { Block } from '@gxchain2/structure';
import { RoundStepType } from './state';
import { Proposal } from './proposal';
import { BitArray } from './bitArray';
import { Vote, VoteType } from './vote';

export interface Message {
  validateBasic();
}

export class NewRoundStepMessage implements Message {
  height: BN;
  round: number;
  step: RoundStepType;
  secondsSinceStartTime: number;
  lastCommitRound: number;

  constructor(height: BN, round: number, step: RoundStepType, secondsSinceStartTime: number, lastCommitRound: number) {
    this.height = height.clone();
    this.round = round;
    this.step = step;
    this.secondsSinceStartTime = secondsSinceStartTime;
    this.lastCommitRound = lastCommitRound;
  }

  validateBasic() {
    throw new Error('Method not implemented.');
  }
}

export class NewValidBlockMessage implements Message {
  height: BN;
  round: number;
  hash: Buffer;
  isCommit: boolean;

  constructor(height: BN, round: number, hash: Buffer, isCommit: boolean) {
    this.height = height.clone();
    this.round = round;
    this.hash = hash;
    this.isCommit = isCommit;
  }

  validateBasic() {
    throw new Error('Method not implemented.');
  }
}

export class ProposalMessage implements Message {
  proposal: Proposal;

  constructor(proposal: Proposal) {
    this.proposal = proposal;
  }

  validateBasic() {
    throw new Error('Method not implemented.');
  }
}

export class ProposalPOLMessage implements Message {
  height: BN;
  proposalPOLRound: number;
  proposalPOL: BitArray;

  constructor(height: BN, proposalPOLRound: number, proposalPOL: BitArray) {
    this.height = height.clone();
    this.proposalPOLRound = proposalPOLRound;
    this.proposalPOL = proposalPOL;
  }

  validateBasic() {
    // TODO: ...
  }
}

export class ProposalBlockMessage implements Message {
  block: Block;

  constructor(block: Block) {
    this.block = block;
  }

  validateBasic() {
    // TODO: ...
  }
}

export class VoteMessage implements Message {
  vote: Vote;

  constructor(vote: Vote) {
    this.vote = vote;
  }

  validateBasic() {
    // TODO: ...
  }
}

export class HasVoteMessage implements Message {
  height: BN;
  round: number;
  type: VoteType;
  index: number;

  constructor(height: BN, round: number, type: VoteType, index: number) {
    this.height = height.clone();
    this.round = round;
    this.type = type;
    this.index = index;
  }

  validateBasic() {
    // TODO: ...
  }
}

export class VoteSetMaj23Message implements Message {
  height: BN;
  round: number;
  type: VoteType;
  hash: Buffer;

  constructor(height: BN, round: number, type: VoteType, hash: Buffer) {
    this.height = height.clone();
    this.round = round;
    this.type = type;
    this.hash = hash;
  }

  validateBasic() {
    // TODO: ...
  }
}

export class VoteSetBitsMessage implements Message {
  height: BN;
  round: number;
  type: VoteType;
  hash: Buffer;
  votes: BitArray;

  constructor(height: BN, round: number, type: VoteType, hash: Buffer, votes: BitArray) {
    this.height = height.clone();
    this.round = round;
    this.type = type;
    this.hash = hash;
    this.votes = votes;
  }

  validateBasic() {
    // TODO: ...
  }
}

export class GetProposalBlockMessage implements Message {
  hash: Buffer;

  constructor(hash: Buffer) {
    this.hash = hash;
  }

  validateBasic() {
    throw new Error('Method not implemented.');
  }
}
