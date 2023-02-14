import { Address, BN, ecsign, ecrecover, rlp, intToBuffer, bnToUnpaddedBuffer, rlphash, bufferToInt } from 'ethereumjs-util';
import { FunctionalBufferMap, logger } from '@rei-network/utils';
import { importBls } from '@rei-network/bls';
import { ActiveValidatorSet } from './validatorSet';
import { BitArray } from './bitArray';
import * as v from './validate';

export class ConflictingVotesError extends Error {
  voteA: Vote;
  voteB: Vote;

  constructor(voteA: Vote, voteB: Vote) {
    super();
    this.voteA = voteA;
    this.voteB = voteB;
  }
}

export class DuplicateVotesError extends Error {}

export enum VoteVersion {
  ecdsaSignature,
  blsSignature
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
  index: number;
}

export class Vote {
  readonly chainId: number;
  readonly type: VoteType;
  readonly height: BN;
  readonly round: number;
  readonly hash: Buffer;
  readonly index: number;
  readonly version: VoteVersion;
  private _signature?: Buffer;
  private _blsSignature?: Buffer;

  static fromSerializedVote(serialized: Buffer) {
    const values = rlp.decode(serialized);
    if (!Array.isArray(values)) {
      throw new Error('invalid serialized vote input. must be array');
    }
    return Vote.fromValuesArray(values as any);
  }

  static fromValuesArray(values: Buffer[]) {
    if (values.length == 8) {
      const [chainId, type, height, round, hash, index, version, signature] = values;
      if (bufferToInt(version) != VoteVersion.ecdsaSignature) {
        throw new Error('invalid vote version');
      }
      return new Vote(
        {
          chainId: bufferToInt(chainId),
          type: bufferToInt(type),
          height: new BN(height),
          round: bufferToInt(round),
          hash,
          index: bufferToInt(index)
        },
        bufferToInt(version),
        signature
      );
    } else if (values.length == 9) {
      const [chainId, type, height, round, hash, index, version, signature, blsSignature] = values;
      if (bufferToInt(version) != VoteVersion.blsSignature) {
        throw new Error('invalid vote version');
      }
      return new Vote(
        {
          chainId: bufferToInt(chainId),
          type: bufferToInt(type),
          height: new BN(height),
          round: bufferToInt(round),
          hash,
          index: bufferToInt(index)
        },
        bufferToInt(version),
        signature,
        blsSignature
      );
    } else {
      throw new Error('invalid values length');
    }
  }

  constructor(data: VoteData, version: number, signature?: Buffer, blsSignature?: Buffer) {
    this.chainId = data.chainId;
    this.type = data.type;
    this.height = data.height.clone();
    this.round = data.round;
    this.hash = data.hash;
    this.index = data.index;
    this.version = version;
    this._signature = signature;
    this._blsSignature = blsSignature;
    this.validateBasic();
  }

  get signature(): Buffer | undefined {
    return this._signature;
  }

  set signature(signature: Buffer | undefined) {
    if (signature !== undefined) {
      v.validateSignature(signature);
      this._signature = signature;
    }
  }

  get blsSignature(): Buffer | undefined {
    if (this.version == VoteVersion.blsSignature) {
      return this._blsSignature;
    }
  }

  set blsSignature(blsSignature: Buffer | undefined) {
    if (this.version == VoteVersion.blsSignature) {
      if (blsSignature !== undefined) {
        v.validateBlsSignature(blsSignature);
        this._blsSignature = blsSignature;
      }
    } else {
      throw new Error('invalid version');
    }
  }

  getMessageToSign() {
    return rlphash([intToBuffer(this.chainId), intToBuffer(this.type), bnToUnpaddedBuffer(this.height), intToBuffer(this.round), this.hash, intToBuffer(this.index)]);
  }

  getMessageToBlsSign() {
    return rlphash([intToBuffer(this.chainId), intToBuffer(this.type), bnToUnpaddedBuffer(this.height), intToBuffer(this.round), this.hash]);
  }

  isSigned() {
    return this._signature && this._signature.length > 0;
  }

  isBlsSigned() {
    return this._blsSignature && this._blsSignature.length > 0;
  }

  raw() {
    if (!this.isSigned()) {
      throw new Error('missing signature');
    }
    if (this.version == VoteVersion.ecdsaSignature) {
      return [intToBuffer(this.chainId), intToBuffer(this.type), bnToUnpaddedBuffer(this.height), intToBuffer(this.round), this.hash, intToBuffer(this.index), intToBuffer(this.version), this._signature!];
    } else if (this.version == VoteVersion.blsSignature) {
      if (!this.isBlsSigned()) {
        throw new Error('missing bls signature');
      }
      return [intToBuffer(this.chainId), intToBuffer(this.type), bnToUnpaddedBuffer(this.height), intToBuffer(this.round), this.hash, intToBuffer(this.index), intToBuffer(this.version), this._signature!, this._blsSignature!];
    } else {
      throw new Error('invalid version');
    }
  }

  serialize() {
    return rlp.encode(this.raw());
  }

  validateBasic() {
    v.validateVoteType(this.type);
    v.validateIndex(this.index);
    v.validateHeight(this.height);
    v.validateRound(this.round);
    v.validateHash(this.hash);
    if (this.isSigned()) {
      v.validateSignature(this._signature!);
    }
    if (this.version == VoteVersion.blsSignature && this.isBlsSigned()) {
      v.validateBlsSignature(this._blsSignature!);
    }
  }

  validateSignature(valSet: ActiveValidatorSet) {
    if (this.index >= valSet.length) {
      throw new Error('invalid index');
    }
    const validator = this.validator();
    if (!validator.equals(valSet.getValidatorByIndex(this.index))) {
      throw new Error('invalid signature');
    }
    if (this.version == VoteVersion.blsSignature) {
      const bls = importBls();
      // Todo: get public key from validator
      let pubKey: Uint8Array = Buffer.from('');
      // pubKey = valSet.getPublicKeyByIndex(this.index);
      if (!bls.verify(pubKey, this.getMessageToBlsSign(), this.blsSignature!)) {
        throw new Error('invalid bls signature');
      }
    } else {
      throw new Error('invalid version');
    }
    return validator;
  }

  validator() {
    if (!this.isSigned()) {
      throw new Error('missing signature');
    }
    const r = this._signature!.slice(0, 32);
    const s = this._signature!.slice(32, 64);
    const v = new BN(this._signature!.slice(64, 65)).addn(27);
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
  valSet: ActiveValidatorSet;

  votesBitArray: BitArray;
  votes: (Vote | undefined)[];
  sum: BN;
  maj23?: Buffer;
  votesByBlock = new FunctionalBufferMap<BlockVotes>();
  peerMaj23s = new Map<string, Buffer>();

  constructor(chainId: number, height: BN, round: number, signedMsgType: VoteType, valSet: ActiveValidatorSet) {
    this.chainId = chainId;
    this.height = height.clone();
    this.round = round;
    this.signedMsgType = signedMsgType;
    this.valSet = valSet;
    this.votesBitArray = new BitArray(valSet.length);
    this.votes = new Array<Vote | undefined>(valSet.length);
    this.sum = new BN(0);
  }

  preValidate(vote: Vote) {
    if (!vote.height.eq(this.height) || vote.round !== this.round || vote.type !== this.signedMsgType) {
      return false;
    }

    const existing = this.votes?.[vote.index];
    const result = existing && existing.hash.equals(vote.hash);
    return !result;
  }

  addVote(vote: Vote) {
    if (!vote.height.eq(this.height) || vote.round !== this.round || vote.type !== this.signedMsgType) {
      logger.detail('VoteSet::addVote, invalid vote');
      return;
    }

    // validate signature and validator address
    const validator = vote.validateSignature(this.valSet);
    const votingPower = this.valSet.getVotingPower(validator);

    // logger.debug('VoteSet::addVote, add vote for:', validator.toString(), 'voting power:', votingPower.toString());
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
        throw new DuplicateVotesError();
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
  valSet: ActiveValidatorSet;

  round: number;
  roundVoteSets = new Map<number, RoundVoteSet>();
  peerCatchupRounds = new Map<string, number[]>();

  constructor(chainId: number, height: BN, valSet: ActiveValidatorSet) {
    this.chainId = chainId;
    this.height = height.clone();
    this.valSet = valSet;
    this.round = 0;
  }

  reset(height: BN, valSet: ActiveValidatorSet) {
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
