import { Address, BN, ecsign, ecrecover, rlp, intToBuffer, bnToUnpaddedBuffer, rlphash, bufferToInt } from 'ethereumjs-util';
import { createBufferFunctionalMap, logger } from '@gxchain2/utils';
import { ValidatorSet } from '../../../staking';
import { BitArray } from './bitArray';

export class ConflictingVotesError extends Error {
  voteA: Vote;
  voteB: Vote;

  constructor(voteA: Vote, voteB: Vote) {
    super();
    this.voteA = voteA;
    this.voteB = voteB;
  }
}

export enum VoteType {
  Proposal,
  Prevote,
  Precommit
}

export interface VoteData {
  chainId: number;
  type: VoteType;
  height: BN;
  round: number;
  hash: Buffer;
  timestamp: number;
  index: number;
}

export class Vote {
  chainId: number;
  type: VoteType;
  height: BN;
  round: number;
  hash: Buffer;
  timestamp: number;
  index: number;
  signature?: Buffer;

  static fromVoteData(data: VoteData) {
    return new Vote(data);
  }

  static fromSerializedVote(serialized: Buffer) {
    const values = rlp.decode(serialized);
    if (!Array.isArray(values)) {
      throw new Error('invalid serialized vote input. must be array');
    }
    return Vote.fromValuesArray(values as any);
  }

  static fromValuesArray(values: Buffer[]) {
    if (values.length !== 8) {
      throw new Error('invalid values length');
    }
    const [chainId, type, height, round, hash, timestamp, index, signature] = values;
    return new Vote(
      {
        chainId: bufferToInt(chainId),
        type: bufferToInt(type),
        height: new BN(height),
        round: bufferToInt(round),
        hash,
        timestamp: bufferToInt(timestamp),
        index: bufferToInt(index)
      },
      signature
    );
  }

  constructor(data: VoteData, signature?: Buffer) {
    this.chainId = data.chainId;
    this.type = data.type;
    this.height = data.height.clone();
    this.round = data.round;
    this.hash = data.hash;
    this.timestamp = data.timestamp;
    this.index = data.index;
    this.signature = signature;
  }

  getMessageToSign() {
    return rlphash([intToBuffer(this.chainId), intToBuffer(this.type), bnToUnpaddedBuffer(this.height), intToBuffer(this.round), this.hash, intToBuffer(this.timestamp), intToBuffer(this.index)]);
  }

  isSigned() {
    return !!this.signature;
  }

  sign(privateKey: Buffer) {
    const { r, s, v } = ecsign(this.getMessageToSign(), privateKey);
    this.signature = Buffer.concat([r, s, intToBuffer(v - 27)]);
  }

  raw() {
    if (!this.signature) {
      throw new Error('missing signature');
    }
    return [intToBuffer(this.chainId), intToBuffer(this.type), bnToUnpaddedBuffer(this.height), intToBuffer(this.round), this.hash, intToBuffer(this.timestamp), intToBuffer(this.index), this.signature];
  }

  serialize() {
    return rlp.encode(this.raw());
  }

  validateBasic() {
    if (this.type !== VoteType.Precommit && this.type !== VoteType.Prevote) {
      throw new Error('invalid vote type');
    }
    if (this.height.isNeg()) {
      throw new Error('invalid height');
    }
    if (this.round < 0 || !Number.isSafeInteger(this.round)) {
      throw new Error('invalid round');
    }
    if (this.hash.length !== 32) {
      throw new Error('invalid hash length');
    }
    if (this.timestamp < 0 || !Number.isSafeInteger(this.timestamp)) {
      throw new Error('invalid timestamp');
    }
    if (this.index < 0) {
      throw new Error('invalid index');
    }
    if (this.signature?.length !== 65) {
      throw new Error('invalid signature length');
    }
  }

  validateSignature(valSet: ValidatorSet) {
    if (this.index >= valSet.length) {
      throw new Error('invalid index');
    }
    const validator = this.validator();
    if (!validator.equals(valSet.getValidatorByIndex(this.index))) {
      throw new Error('invalid signature');
    }
    return validator;
  }

  validator() {
    const r = this.signature!.slice(0, 32);
    const s = this.signature!.slice(32, 64);
    const v = new BN(this.signature!.slice(64, 65)).addn(27);
    return Address.fromPublicKey(ecrecover(this.getMessageToSign(), v, r, s));
  }
}

export class BlockVotes {
  peerMaj23: boolean;
  bitArray: BitArray;
  votes: (Vote | undefined)[];
  sum: BN;

  constructor(peerMaj23: boolean, numValidators: number) {
    this.peerMaj23 = peerMaj23;
    this.bitArray = new BitArray(numValidators);
    this.votes = new Array<Vote | undefined>(numValidators);
    this.sum = new BN(0);
  }

  addVerifiedVote(vote: Vote, votingPower: BN) {
    const existing = this.votes[vote.index];
    if (existing === undefined) {
      this.bitArray.setIndex(vote.index, true);
      this.votes[vote.index] = vote;
      this.sum.iadd(votingPower);
    }
  }

  getByIndex(index: number) {
    if (index >= this.votes.length) {
      throw new Error('vote index overflow');
    }
    return this.votes[index];
  }
}

export class VoteSet {
  chainId: number;
  height: BN;
  round: number;
  signedMsgType: VoteType;
  valSet: ValidatorSet;

  votesBitArray: BitArray;
  votes: (Vote | undefined)[];
  sum: BN;
  maj23?: Buffer;
  votesByBlock = createBufferFunctionalMap<BlockVotes>();
  peerMaj23s = new Map<string, Buffer>();

  constructor(chainId: number, height: BN, round: number, signedMsgType: VoteType, valSet: ValidatorSet) {
    this.chainId = chainId;
    this.height = height.clone();
    this.round = round;
    this.signedMsgType = signedMsgType;
    this.valSet = valSet;
    this.votesBitArray = new BitArray(valSet.length);
    this.votes = new Array<Vote | undefined>(valSet.length);
    this.sum = new BN(0);
  }

  addVote(vote: Vote) {
    if (!vote.height.eq(this.height) || vote.round !== this.round || vote.type !== this.signedMsgType) {
      throw new Error('unexpected vote');
    }

    // validate signature and validator address
    const validator = vote.validateSignature(this.valSet);
    const votingPower = this.valSet.getVotingPower(validator);

    logger.debug('VoteSet::addVote, add vote for:', validator.toString(), 'voting power:', votingPower.toString());
    return this.addVerifiedVote(vote, votingPower);
  }

  getVote(valIndex: number, hash: Buffer) {
    let vote = this.votes[valIndex];
    if (vote && vote.hash.equals(hash)) {
      return vote;
    }
    return this.votesByBlock.get(hash)?.getByIndex(valIndex);
  }

  getVoteByIndex(index: number) {
    return this.votes[index];
  }

  addVerifiedVote(vote: Vote, votingPower: BN) {
    let conflicting: Vote | undefined;
    const idx = vote.index;

    const existing = this.votes[idx];
    if (existing) {
      if (existing.hash.equals(vote.hash)) {
        throw new Error('unexpected duplicate votes');
      } else {
        conflicting = existing;
      }
      if (this.maj23 !== undefined && this.maj23.equals(vote.hash)) {
        this.votes[idx] = vote;
        this.votesBitArray.setIndex(idx, true);
      }
    } else {
      this.votes[idx] = vote;
      this.votesBitArray.setIndex(idx, true);
      this.sum.iadd(votingPower);
    }

    let votesByBlock = this.votesByBlock.get(vote.hash);
    if (votesByBlock) {
      if (conflicting !== undefined && !votesByBlock.peerMaj23) {
        return conflicting;
      }
    } else {
      if (conflicting !== undefined) {
        return conflicting;
      }

      votesByBlock = new BlockVotes(false, this.valSet.length);
      this.votesByBlock.set(vote.hash, votesByBlock);
    }

    const origSum = votesByBlock.sum.clone();
    const quorum = this.valSet.totalVotingPower.muln(2).divn(3).addn(1);

    votesByBlock.addVerifiedVote(vote, votingPower);

    if (origSum.lt(quorum) && quorum.lte(votesByBlock.sum)) {
      if (this.maj23 === undefined) {
        this.maj23 = vote.hash;
        votesByBlock.votes.forEach((v, i) => {
          if (v !== undefined) {
            this.votes[i] = v;
          }
        });
      }
    }
    return undefined;
  }

  setPeerMaj23(peerId: string, hash: Buffer) {
    const existing = this.peerMaj23s.get(peerId);
    if (existing) {
      if (existing.equals(hash)) {
        return;
      }
      throw new Error('conflicting maj23 block');
    }
    this.peerMaj23s.set(peerId, hash);

    let votesByBlock = this.votesByBlock.get(hash);
    if (votesByBlock) {
      votesByBlock.peerMaj23 = true;
    } else {
      this.votesByBlock.set(hash, new BlockVotes(true, this.valSet.length));
    }
  }

  hasTwoThirdsMajority() {
    return !!this.maj23;
  }

  hasTwoThirdsAny() {
    return this.sum.gt(this.valSet.totalVotingPower.muln(2).divn(3));
  }

  voteCount() {
    return this.votes.filter((v) => !!v).length;
  }

  bitArrayByBlockID(hash: Buffer) {
    return this.votesByBlock.get(hash)?.bitArray.copy();
  }

  isCommit() {
    return this.signedMsgType === VoteType.Precommit && !!this.maj23;
  }
}

export type RoundVoteSet = {
  prevotes: VoteSet;
  precommits: VoteSet;
};

export class HeightVoteSet {
  chainId: number;
  height: BN;
  valSet: ValidatorSet;

  round: number;
  roundVoteSets = new Map<number, RoundVoteSet>();
  peerCatchupRounds = new Map<string, number[]>();

  constructor(chainId: number, height: BN, valSet: ValidatorSet) {
    this.chainId = chainId;
    this.height = height.clone();
    this.valSet = valSet;
    this.round = 0;
  }

  reset(height: BN, valSet: ValidatorSet) {
    this.height = height.clone();
    this.valSet = valSet;
    this.roundVoteSets.clear();
    this.peerCatchupRounds.clear();

    this.addRound(0);
    this.round = 0;
  }

  setRound(round: number) {
    if (this.round !== 0 && round < this.round) {
      throw new Error('setRound, must increment round');
    }
    for (let i = this.round; i <= round; i++) {
      if (this.roundVoteSets.get(i) === undefined) {
        this.addRound(i);
      }
    }
    this.round = round;
  }

  private addRound(round: number) {
    let roundVoteSet = this.roundVoteSets.get(round);
    if (roundVoteSet) {
      throw new Error('addRound for an existing round');
    }
    this.roundVoteSets.set(round, {
      prevotes: new VoteSet(this.chainId, this.height, round, VoteType.Prevote, this.valSet),
      precommits: new VoteSet(this.chainId, this.height, round, VoteType.Precommit, this.valSet)
    });
  }

  getVoteSet(round: number, voteType: VoteType) {
    return this.roundVoteSets.get(round)?.[voteType === VoteType.Prevote ? 'prevotes' : 'precommits'];
  }

  addVote(vote: Vote, peerId: string) {
    vote.validateBasic();
    let voteSet = this.getVoteSet(vote.round, vote.type);
    if (voteSet === undefined) {
      let catchupRounds = this.peerCatchupRounds.get(peerId);
      if (!catchupRounds) {
        catchupRounds = [];
        this.peerCatchupRounds.set(peerId, catchupRounds);
      }
      if (catchupRounds.length < 2) {
        this.addRound(vote.round);
        voteSet = this.getVoteSet(vote.round, vote.type)!;
        catchupRounds.push(vote.round);
      } else {
        // TODO: special error
        throw new Error('unwanted round');
      }
    }
    const conflicting = voteSet.addVote(vote);
    if (conflicting) {
      throw new ConflictingVotesError(conflicting, vote);
    }
  }

  prevotes(round: number) {
    return this.getVoteSet(round, VoteType.Prevote);
  }

  precommits(round: number) {
    return this.getVoteSet(round, VoteType.Precommit);
  }

  POLInfo(): [number, Buffer] | undefined {
    for (let i = this.round; i >= 0; i--) {
      const voteSet = this.getVoteSet(i, VoteType.Prevote);
      if (voteSet && voteSet.maj23) {
        return [i, voteSet.maj23];
      }
    }
    return undefined;
  }

  setPeerMaj23(round: number, type: VoteType, peerId: string, hash: Buffer) {
    // TODO: setRound?
    const voteSet = this.getVoteSet(round, type);
    if (voteSet) {
      voteSet.setPeerMaj23(peerId, hash);
    }
  }
}
