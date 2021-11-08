import { BN, rlp, intToBuffer, bufferToInt } from 'ethereumjs-util';
import { BlockHeader, CLIQUE_EXTRA_VANITY } from '@gxchain2/structure';
import { ValidatorSet } from '../../../staking';
import { Reimint } from '../reimint';
import { Vote, VoteType, VoteSet } from './vote';
import { Evidence, EvidenceBuffer, EvidenceFactory } from './evidence';
import { Proposal } from './proposal';

export interface ExtraDataOptions {
  header: BlockHeader;
  valSet?: ValidatorSet;
  increaseValSet?: boolean;
  chainId: number;
}

export interface ExtraDataFromBlockHeaderOptions extends Omit<ExtraDataOptions, 'header' | 'chainId'> {}

export type RLPVote = [Buffer, Buffer];
export type RLPEmptyVote = [];
export type RLPRoundAndPOLRound = [Buffer, Buffer];
export type RLPEvidenceList = [EvidenceBuffer][];
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
  if (!(ele[0] instanceof Buffer) || !(ele[1] instanceof Buffer)) {
    return false;
  }
  return true;
}

function isRLPEvidenceList(ele: RLPElement): ele is RLPEvidenceList {
  if (!Array.isArray(ele)) {
    return false;
  }
  for (const ev of ele) {
    if (!(ev instanceof Buffer)) {
      if (!Array.isArray(ev)) {
        return false;
      }

      for (const _ele of ev) {
        if (!(_ele instanceof Buffer)) {
          return false;
        }
      }
    }
  }
  return true;
}

export class ExtraData {
  readonly evidence: Evidence[];
  readonly round: number;
  readonly POLRound: number;
  readonly proposal: Proposal;
  readonly voteSet?: VoteSet;

  static fromBlockHeader(header: BlockHeader, options?: ExtraDataFromBlockHeaderOptions) {
    if (header.extraData.length <= CLIQUE_EXTRA_VANITY) {
      throw new Error('invalid header');
    }
    return ExtraData.fromSerializedData(header.extraData.slice(CLIQUE_EXTRA_VANITY), { ...options, header, chainId: header._common.chainIdBN().toNumber() });
  }

  static fromSerializedData(serialized: Buffer, options: ExtraDataOptions) {
    const values = rlp.decode(serialized) as unknown as RLPElements;
    if (!Array.isArray(values)) {
      throw new Error('invalid serialized value');
    }
    return ExtraData.fromValuesArray(values, options);
  }

  static fromValuesArray(values: RLPElements, { header, valSet, chainId, increaseValSet }: ExtraDataOptions) {
    // the additional extra data should include at lease 3 elements(RLPRoundAndPOLRound, RLPEvidenceList, RLPVote(proposal))
    if (values.length < 3) {
      throw new Error('invliad values');
    }

    let round!: number;
    let POLRound!: number;
    let headerHash!: Buffer;
    let proposal!: Proposal;
    let evidence!: Evidence[];
    let voteSet: VoteSet | undefined;
    if (valSet) {
      // validator size + 1(round and POLRound list) + 1(evidence list) + 1(proposal)
      if (values.length !== valSet.length + 3) {
        throw new Error('invalid values length');
      }
    }

    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (i === 0) {
        if (!isRLPRoundAndPOLRound(value)) {
          throw new Error('invliad values');
        }
        round = bufferToInt(value[0]);
        POLRound = bufferToInt(value[1]) - 1;

        // increase round
        if (increaseValSet && valSet) {
          valSet = valSet.copy();
          valSet.incrementProposerPriority(round);
        }
        if (valSet) {
          voteSet = new VoteSet(chainId, header.number, round, VoteType.Precommit, valSet);
        }
      } else if (i === 1) {
        if (!isRLPEvidenceList(value)) {
          throw new Error('invliad values');
        }

        evidence = value.map((buf) => {
          const ev = EvidenceFactory.fromValuesArray(buf);
          // TODO: ev.validate()
          return ev;
        });

        // calculate block hash
        headerHash = Reimint.calcBlockHeaderRawHash(header, round, POLRound, evidence);
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
        if (valSet) {
          proposal.validateSignature(valSet.proposer);
        }
      } else {
        if (isRLPVote(value)) {
          if (!voteSet) {
            break;
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
          const conflicting = voteSet.addVote(vote);
          if (conflicting) {
            throw new Error('conflicting vote');
          }
        } else if (!isRLPEmptyVote(value)) {
          throw new Error('invliad values');
        }
      }
    }

    return new ExtraData(round, POLRound, evidence, proposal, voteSet);
  }

  constructor(round: number, POLRound: number, evidence: Evidence[], proposal: Proposal, voteSet?: VoteSet) {
    this.round = round;
    this.POLRound = POLRound;
    this.proposal = proposal;
    this.evidence = evidence;
    this.voteSet = voteSet;
    if (voteSet && voteSet.signedMsgType !== VoteType.Precommit) {
      throw new Error('invalid vote set type');
    }
  }

  raw(validaterSetSize?: number) {
    const raw: rlp.Input = [];
    raw.push([intToBuffer(this.round), intToBuffer(this.POLRound + 1)]);
    raw.push(this.evidence.map((ev) => ev.raw()));
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

  validatorSet() {
    return this.voteSet?.valSet;
  }

  validate() {
    if (this.round < 0 || this.round >= Number.MAX_SAFE_INTEGER) {
      throw new Error('invalid round');
    }
    if (this.POLRound < -1 || this.POLRound >= Number.MAX_SAFE_INTEGER - 1) {
      throw new Error('invalid POLRound');
    }

    if (!this.voteSet || this.voteSet.voteCount() === 0) {
      throw new Error('empty vote set');
    }
    if (!this.voteSet.maj23 || !this.voteSet.maj23.equals(this.proposal.hash)) {
      throw new Error('invalid vote set');
    }
  }
}
