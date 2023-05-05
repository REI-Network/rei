import { Address, BN, ecsign, ecrecover, rlp, intToBuffer, bnToUnpaddedBuffer, rlphash, bufferToInt, toBuffer } from 'ethereumjs-util';
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

export enum SignatureType {
  ECDSA,
  BLS
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
  validator?: Address;
}

export class Vote {
  readonly chainId: number;
  readonly type: VoteType;
  readonly height: BN;
  readonly round: number;
  readonly hash: Buffer;
  readonly index: number;
  readonly validator?: Address;

  readonly signatureType: SignatureType;
  private _signature?: Buffer;

  /**
   * New vote from serialized data
   * @param serialized - Serialized vote
   * @returns Vote
   */
  static fromSerializedVote(serialized: Buffer) {
    const values = rlp.decode(serialized);
    if (!Array.isArray(values)) {
      throw new Error('invalid serialized vote input. must be array');
    }
    return Vote.fromValuesArray(values as any);
  }

  /**
   * New vote from values array
   * @param values - Values array
   * @returns Vote
   */
  static fromValuesArray(values: Buffer[]) {
    if (values.length === 7) {
      const [chainId, type, height, round, hash, index, signature] = values;
      return new Vote(
        {
          chainId: bufferToInt(chainId),
          type: bufferToInt(type),
          height: new BN(height),
          round: bufferToInt(round),
          hash,
          index: bufferToInt(index)
        },
        SignatureType.ECDSA,
        signature
      );
    } else if (values.length === 8) {
      const [chainId, type, height, round, hash, index, validator, signature] = values;
      return new Vote(
        {
          chainId: bufferToInt(chainId),
          type: bufferToInt(type),
          height: new BN(height),
          round: bufferToInt(round),
          hash,
          index: bufferToInt(index),
          validator: new Address(validator)
        },
        SignatureType.BLS,
        signature
      );
    } else {
      throw new Error('invalid values length');
    }
  }

  constructor(data: VoteData, signatureType: SignatureType, signature?: Buffer) {
    this.chainId = data.chainId;
    this.type = data.type;
    this.height = data.height.clone();
    this.round = data.round;
    this.hash = data.hash;
    this.index = data.index;
    this.validator = data.validator;
    this.signatureType = signatureType;
    this._signature = signature;
    this.validateBasic();
  }

  /**
   * Get vote signature
   */
  get signature(): Buffer | undefined {
    return this._signature;
  }

  /**
   * Set vote signature
   */
  set signature(signature: Buffer | undefined) {
    if (signature !== undefined) {
      if (this.signatureType === SignatureType.ECDSA) {
        v.validateSignature(signature);
      } else {
        v.validateBlsSignature(signature);
      }
      this._signature = signature;
    }
  }

  /**
   * Get message to sign
   * @returns message to sign
   */
  getMessageToSign() {
    if (this.signatureType === SignatureType.ECDSA) {
      return rlphash([intToBuffer(this.chainId), intToBuffer(this.type), bnToUnpaddedBuffer(this.height), intToBuffer(this.round), this.hash, intToBuffer(this.index)]);
    } else {
      return rlphash([intToBuffer(this.chainId), intToBuffer(this.type), bnToUnpaddedBuffer(this.height), intToBuffer(this.round), this.hash]);
    }
  }

  /**
   * Get validator address
   * @returns Validator address
   */
  getValidator() {
    if (this.signatureType === SignatureType.ECDSA) {
      if (!this.isSigned()) {
        throw new Error('missing signature');
      }
      const r = this._signature!.slice(0, 32);
      const s = this._signature!.slice(32, 64);
      const v = new BN(this._signature!.slice(64, 65)).addn(27);
      return Address.fromPublicKey(ecrecover(this.getMessageToSign(), v, r, s));
    } else {
      return this.validator!;
    }
  }

  /**
   * Is vote signed
   * @returns True if vote is signed, false otherwise
   */
  isSigned() {
    return this._signature && this._signature.length > 0;
  }

  /**
   * Sign vote
   * @param privateKey - ECDSA or BLS private key
   */
  sign(privateKey: Buffer) {
    if (this.signatureType === SignatureType.ECDSA) {
      const { r, s, v } = ecsign(this.getMessageToSign(), privateKey);
      this.signature = Buffer.concat([r, s, intToBuffer(v - 27)]);
    } else {
      this.signature = Buffer.from(importBls().sign(privateKey, this.getMessageToSign()));
    }
  }

  /**
   * Vote raw data
   * @returns Raw data
   */
  raw() {
    if (!this.isSigned()) {
      throw new Error('missing signature');
    }
    if (this.signatureType === SignatureType.ECDSA) {
      return [intToBuffer(this.chainId), intToBuffer(this.type), bnToUnpaddedBuffer(this.height), intToBuffer(this.round), this.hash, intToBuffer(this.index), this._signature!];
    } else {
      return [intToBuffer(this.chainId), intToBuffer(this.type), bnToUnpaddedBuffer(this.height), intToBuffer(this.round), this.hash, intToBuffer(this.index), toBuffer(this.validator!), this._signature!];
    }
  }

  /**
   * Vote serialized data
   * @returns Serialized data
   */
  serialize() {
    return rlp.encode(this.raw());
  }

  /**
   * Validate vote basicly
   */
  validateBasic() {
    v.validateVoteType(this.type);
    v.validateHeight(this.height);
    v.validateRound(this.round);
    v.validateHash(this.hash);
    v.validateIndex(this.index);
    if (this.signatureType === SignatureType.BLS) {
      if (!this.validator) {
        throw new Error('missing validator address');
      }
    }
    if (this.isSigned()) {
      if (this.signatureType === SignatureType.ECDSA) {
        v.validateSignature(this.signature!);
      } else {
        v.validateBlsSignature(this.signature!);
      }
    }
  }

  /**
   * Validate vote signature
   * @param valSet - Active validator set
   * @returns Validator address
   */
  validateSignature(valSet: ActiveValidatorSet) {
    if (!this.isSigned()) {
      throw new Error('missing signature');
    }
    if (this.index >= valSet.length) {
      throw new Error('invalid index');
    }
    const validator = this.getValidator();
    if (!validator.equals(valSet.getValidatorByIndex(this.index))) {
      throw new Error('invalid signature');
    }
    if (this.signatureType === SignatureType.BLS) {
      if (!importBls().verify(valSet.getBlsPublicKey(validator), this.getMessageToSign(), this.signature!)) {
        throw new Error('invalid signature');
      }
    }
    return validator;
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
  version: SignatureType;
  aggregatedSignature: Buffer | undefined;

  votesBitArray: BitArray;
  votes: (Vote | undefined)[];
  sum: BN;
  maj23?: Buffer;
  votesByBlock = new FunctionalBufferMap<BlockVotes>();
  peerMaj23s = new Map<string, Buffer>();

  constructor(chainId: number, height: BN, round: number, signedMsgType: VoteType, valSet: ActiveValidatorSet, version: SignatureType) {
    this.chainId = chainId;
    this.height = height.clone();
    this.round = round;
    this.signedMsgType = signedMsgType;
    this.valSet = valSet;
    this.version = version;
    this.votesBitArray = new BitArray(valSet.length);
    this.votes = new Array<Vote | undefined>(valSet.length);
    this.sum = new BN(0);
  }

  /**
   * Pre-validate vote for p2p network
   * @param vote - Vote
   * @returns
   */
  preValidate(vote: Vote) {
    if (!vote.height.eq(this.height) || vote.round !== this.round || vote.type !== this.signedMsgType || vote.signatureType !== this.version) {
      return false;
    }

    const existing = this.votes?.[vote.index];
    const result = existing && existing.hash.equals(vote.hash);
    return !result;
  }

  /**
   * Add vote to vote set
   * @param vote - Vote
   * @returns
   */
  addVote(vote: Vote) {
    if (!vote.height.eq(this.height) || vote.round !== this.round || vote.type !== this.signedMsgType || vote.signatureType !== this.version) {
      logger.detail('VoteSet::addVote, invalid vote');
      return;
    }

    // validate signature and validator address
    const validator = vote.validateSignature(this.valSet);
    const votingPower = this.valSet.getVotingPower(validator);

    // logger.debug('VoteSet::addVote, add vote for:', validator.toString(), 'voting power:', votingPower.toString());
    return this.addVerifiedVote(vote, votingPower);
  }

  /**
   * Get vote by validator index and vote hash
   * @param valIndex - Validator index
   * @param hash - vote hash
   * @returns
   */
  getVote(valIndex: number, hash: Buffer) {
    let vote = this.votes[valIndex];
    if (vote && vote.hash.equals(hash)) {
      return vote;
    }
    return this.votesByBlock.get(hash)?.getByIndex(valIndex);
  }

  /**
   * Get vote by validator index
   * @param index - Validator index
   * @returns
   */
  getVoteByIndex(index: number) {
    return this.votes[index];
  }

  /**
   * Add verified vote to vote set
   * @param vote - Vote
   * @param votingPower - Voting power
   * @returns
   */
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

  /**
   * Set peer maj23 hash
   * @param peerId - Peer id
   * @param hash - proposal hash 2 out of 3 verified
   * @returns
   */
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

  /**
   * Get peer maj23 hash
   * @returns peer maj23 hash
   */
  hasTwoThirdsMajority() {
    return !!this.maj23;
  }

  /**
   * Check if has 2/3 majority
   * @returns
   */
  hasTwoThirdsAny() {
    return this.sum.gt(this.valSet.totalVotingPower.muln(2).divn(3));
  }

  /**
   * Get vote count
   * @returns vote count
   */
  voteCount() {
    return this.votes.filter((v) => !!v).length;
  }

  /**
   * Get bit array by block id
   * @param hash
   * @returns
   */
  bitArrayByBlockID(hash: Buffer) {
    return this.votesByBlock.get(hash)?.bitArray.copy();
  }

  /**
   * Check if is commit
   * @returns true if is commit
   */
  isCommit() {
    return this.signedMsgType === VoteType.Precommit && !!this.maj23;
  }

  /**
   * Get aggregated blsSignature
   * @returns Aggregated signature
   */
  getAggregatedSignature() {
    if (!this.hasTwoThirdsMajority()) {
      throw new Error('Not enough votes to aggregate signature');
    }
    if (!this.aggregatedSignature) {
      this.aggregatedSignature = Buffer.from(importBls().aggregateSignatures(this.votes.filter((v) => !!v).map((v) => v!.signature!)));
    }
    return this.aggregatedSignature;
  }

  /**
   * Verify and set aggregated blsSignature
   * @param signature - bls signature
   * @param bitArray - bit array
   * @param msgHash - message hash
   * @param blockHash - block hash
   */
  setAggregatedSignature(signature: Buffer, bitArray: BitArray, msgHash: Buffer, blockHash: Buffer) {
    const len = bitArray.length;
    const pubKeys: Buffer[] = [];
    let sum: BN = new BN(0);
    for (let i = 0; i < len; i++) {
      if (bitArray.getIndex(i)) {
        const pubKey = this.valSet.activeValidators()[i].blsPublicKey;
        if (!pubKey) {
          throw new Error('missing validator public key');
        }
        pubKeys.push(pubKey);
        sum.iadd(this.valSet.getVotingPower(this.valSet.getValidatorByIndex(i)));
      }
    }

    if (!importBls().verifyAggregate(pubKeys, msgHash, signature) || sum.lte(this.valSet.totalVotingPower.muln(2).divn(3))) {
      return;
    }

    this.maj23 = blockHash;
    this.aggregatedSignature = signature;
    this.votesBitArray = bitArray;
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
  signatureType: SignatureType;

  round: number;
  roundVoteSets = new Map<number, RoundVoteSet>();
  peerCatchupRounds = new Map<string, number[]>();

  constructor(chainId: number, height: BN, valSet: ActiveValidatorSet, signatureType: SignatureType) {
    this.chainId = chainId;
    this.height = height.clone();
    this.valSet = valSet;
    this.round = 0;
    this.signatureType = signatureType;
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
      prevotes: new VoteSet(this.chainId, this.height, round, VoteType.Prevote, this.valSet, this.signatureType),
      precommits: new VoteSet(this.chainId, this.height, round, VoteType.Precommit, this.valSet, this.signatureType)
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
