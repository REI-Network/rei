import { Address, BN, rlp, intToBuffer, rlphash } from 'ethereumjs-util';
import { Block, BlockHeader, CLIQUE_EXTRA_VANITY } from '@gxchain2/structure';
import { ValidatorSet } from '../../staking';
import { Vote, VoteType, VoteSet } from './vote';
import { Proposal } from './proposal';

export function Block_hash(block: Block) {
  return BlockHeader_hash(block.header);
}

export function BlockHeader_hash(header: BlockHeader) {
  return ExtraData.fromBlockHeader(header).proposal.hash;
}

export interface ExtraDataOptions {
  header: BlockHeader;
  valSet?: ValidatorSet;
  chainId: number;
}

export type RLPVote = [Buffer, Buffer];
export type RLPEmptyVote = [];
export type RLPRoundAndPOLRound = [number, number];
export type RLPEvidenceList = [RLPVote, RLPVote][];
export type RLPElement = RLPEmptyVote | RLPVote | RLPRoundAndPOLRound | RLPEvidenceList;
export type RLPElements = RLPElement[];

function isRLPVote(ele: RLPElement): ele is RLPVote {
  if (!Array.isArray(ele) || ele.length !== 2) {
    return false;
  }
  if (!(ele[0] instanceof Buffer) || !(ele[1] instanceof Buffer)) {
    return false;
  }
  return true;
}

function isRLPEmptyVote(ele: RLPElement): ele is RLPEmptyVote {
  if (!Array.isArray(ele)) {
    return false;
  }
  return ele.length === 0;
}

function isRLPRoundAndPOLRound(ele: RLPElement): ele is RLPRoundAndPOLRound {
  if (!Array.isArray(ele) || ele.length !== 2) {
    return false;
  }
  if (typeof ele[0] !== 'number' || typeof ele[1] !== 'number') {
    return false;
  }
  return true;
}

function isRLPEvidenceList(ele: RLPElement): ele is RLPEvidenceList {
  if (!Array.isArray(ele)) {
    return false;
  }
  for (const ev of ele) {
    if (!Array.isArray(ev) || ev.length !== 2) {
      return false;
    }
    if (!isRLPVote(ev[0]) || !isRLPVote(ev[1])) {
      return false;
    }
  }
  return true;
}

export function calcBlockHeaderHash(header: BlockHeader, round: number, POLRound: number) {
  const raw = header.raw();
  raw[12] = Buffer.concat([raw[12].slice(0, CLIQUE_EXTRA_VANITY), intToBuffer(round), intToBuffer(POLRound + 1)]);
  return rlphash(raw);
}

export class ExtraData {
  // evidence: any;
  readonly round: number;
  readonly POLRound: number;
  readonly proposal: Proposal;
  readonly voteSet?: VoteSet;

  static fromBlockHeader(header: BlockHeader, valSet?: ValidatorSet) {
    return ExtraData.fromSerializedData(header.extraData.slice(CLIQUE_EXTRA_VANITY), { header, chainId: header._common.chainIdBN().toNumber(), valSet });
  }

  static fromSerializedData(serialized: Buffer, options: ExtraDataOptions) {
    const values = rlp.decode(serialized) as unknown as RLPElements;
    if (!Array.isArray(values)) {
      throw new Error('invalid serialized value');
    }
    return ExtraData.fromValuesArray(values, options);
  }

  static fromValuesArray(values: RLPElements, { header, valSet, chainId }: ExtraDataOptions) {
    // the additional extra data should include at lease 3 elements(RLPRoundAndPOLRound, RLPEvidenceList, RLPVote(proposal))
    if (values.length < 3) {
      throw new Error('invliad values');
    }

    let round!: number;
    let POLRound!: number;
    let headerHash!: Buffer;
    let proposal!: Proposal;
    let voteSet: VoteSet | undefined;
    if (valSet) {
      // validator size + 1(round and POLRound list) + 1(evidence list) + 1(proposal)
      if (values.length !== valSet.length + 3) {
        throw new Error('invalid values length');
      }
      voteSet = new VoteSet(chainId, header.number, round, VoteType.Precommit, valSet);
    }

    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (i === 0) {
        if (!isRLPRoundAndPOLRound(value)) {
          throw new Error('invliad values');
        }
        round = value[0];
        POLRound = value[1] - 1;
      } else if (i === 1) {
        if (!isRLPEvidenceList(value)) {
          throw new Error('invliad values');
        }
        // TODO: evidence

        // calculate block hash
        headerHash = calcBlockHeaderHash(header, round, POLRound);
      } else if (i === 2) {
        if (!isRLPVote(value)) {
          throw new Error('invliad values');
        }

        const [timestampBuf, signature] = value;
        proposal = new Proposal(
          {
            round,
            POLRound,
            height: header.number,
            type: VoteType.Proposal,
            hash: headerHash,
            timestamp: new BN(timestampBuf).toNumber()
          },
          signature
        );
        proposal.validateBasic();
      } else {
        if (isRLPVote(value)) {
          if (!voteSet) {
            throw new Error('missing validator set');
          }
          const [timestampBuf, signature] = value;
          const vote = new Vote(
            {
              type: VoteType.Precommit,
              hash: headerHash,
              timestamp: new BN(timestampBuf).toNumber(),
              height: header.number,
              round,
              index: i - 3,
              chainId
            },
            signature
          );
          vote.validateBasic();
          const conflicting = voteSet.addVote(vote);
          if (conflicting) {
            throw new Error('conflicting vote');
          }
        } else if (!isRLPEmptyVote(value)) {
          throw new Error('invliad values');
        }
      }
    }

    return new ExtraData(round, POLRound, proposal, voteSet);
  }

  constructor(round: number, POLRound: number, proposal: Proposal, voteSet?: VoteSet) {
    this.round = round;
    this.POLRound = POLRound;
    this.proposal = proposal;
    this.voteSet = voteSet;
  }

  raw(validaterSetSize?: number) {
    const raw: rlp.Input = [];
    raw.push([intToBuffer(this.round), intToBuffer(this.POLRound + 1)]);
    raw.push([]); // TODO: evidence
    raw.push([intToBuffer(this.proposal.timestamp), this.proposal.signature!]);
    if (this.voteSet) {
      for (const vote of this.voteSet.votes) {
        if (vote === undefined) {
          raw.push([]);
        } else {
          raw.push([intToBuffer(vote.timestamp), vote.signature!]);
        }
      }
    } else {
      if (validaterSetSize === undefined) {
        throw new Error('missing validater set size');
      }
      for (let i = 0; i < validaterSetSize; i++) {
        raw.push([]);
      }
    }
    return raw;
  }

  serialize(validaterSetSize?: number) {
    return rlp.encode(this.raw(validaterSetSize));
  }

  validateRoundAndPOLRound() {
    if (this.round < 0 || this.round >= Number.MAX_SAFE_INTEGER) {
      throw new Error('invalid round');
    }
    if (this.POLRound < -1 || this.POLRound >= Number.MAX_SAFE_INTEGER - 1) {
      throw new Error('invalid POLRound');
    }
  }

  validateProposer(proposer: Address) {
    this.proposal.validateSignature(proposer);
  }

  validateVotes(headerHash: Buffer) {
    if (!this.voteSet || this.voteSet.voteCount() === 0) {
      throw new Error('empty vote set');
    }
    if (this.voteSet.signedMsgType !== VoteType.Precommit) {
      throw new Error('invalid vote type');
    }
    if (!this.voteSet.maj23 || !this.voteSet.maj23.equals(headerHash)) {
      throw new Error('invalid vote set');
    }
  }

  validate(headerHash: Buffer) {
    this.validateRoundAndPOLRound();
    this.validateVotes(headerHash);
    this.validateProposer(this.voteSet!.valSet.proposer());
  }
}