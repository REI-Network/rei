import { rlp, intToBuffer, bufferToInt, BNLike, Address } from 'ethereumjs-util';
import VM from '@gxchain2-ethereumjs/vm';
import { Common } from '@gxchain2/common';
import { Block, BlockHeader, CLIQUE_EXTRA_VANITY } from '@gxchain2/structure';
import { ValidatorSet, ValidatorSets } from '../../../staking';
import { StakeManager } from '../../../contracts';
import { Reimint } from '../reimint';
import { Vote, VoteType, VoteSet } from './vote';
import { EvidenceFactory } from './evidencFactory';
import { Evidence, DuplicateVoteEvidence } from './evidence';
import { Proposal } from './proposal';
import * as v from './validate';

export interface ExtraDataOptions {
  chainId: number;
  header: BlockHeader;
  valSet?: ValidatorSet;
}

export interface ExtraDataFromBlockHeaderOptions extends Omit<ExtraDataOptions, 'header' | 'chainId'> {}

export type EXVote = Buffer;
export type EXEmptyVote = [];
export type EXRoundAndPOLRound = [Buffer, Buffer] | [Buffer, Buffer, Buffer];
export type EXEvidenceList = (Buffer | Buffer[])[];
export type EXElement = EXEmptyVote | EXVote | EXRoundAndPOLRound | EXEvidenceList;
export type EXElements = EXElement[];

function isEXVote(ele: EXElement): ele is EXVote {
  return ele instanceof Buffer;
}

function isEXEmptyVote(ele: EXElement): ele is EXEmptyVote {
  if (!Array.isArray(ele)) {
    return false;
  }
  return ele.length === 0;
}

function isEXRoundAndPOLRound(ele: EXElement): ele is EXRoundAndPOLRound {
  if (!Array.isArray(ele) || (ele.length !== 2 && ele.length !== 3)) {
    return false;
  }
  if (!(ele[0] instanceof Buffer) || !(ele[1] instanceof Buffer) || (ele.length === 3 && !(ele[2] instanceof Buffer))) {
    return false;
  }
  return true;
}

function isEXEvidenceList(ele: EXElement): ele is EXEvidenceList {
  if (!Array.isArray(ele)) {
    return false;
  }
  return true;
}

export interface ExtraDataValidateBackend {
  readonly validatorSets: ValidatorSets;
  getCommon(num: BNLike): Common;
  getStakeManager(vm: VM, block: Block, common?: Common): StakeManager;
  getVM(root: Buffer, num: BNLike | Common): Promise<VM>;
}

export class ExtraData {
  readonly evidence: Evidence[];
  readonly round: number;
  readonly commitRound: number;
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
    const values = rlp.decode(serialized) as unknown as EXElements;
    if (!Array.isArray(values)) {
      throw new Error('invalid serialized value');
    }
    return ExtraData.fromValuesArray(values, options);
  }

  static fromValuesArray(values: EXElements, { header, valSet, chainId }: ExtraDataOptions) {
    // the additional extra data should include at lease 3 elements(EXEvidenceList + EXRoundAndPOLRound, EXVote(proposal))
    if (values.length < 3) {
      throw new Error('invliad values');
    }

    let round!: number;
    let commitRound!: number;
    let POLRound!: number;
    let headerHash!: Buffer;
    let proposer: Address | undefined;
    let proposal!: Proposal;
    let evidence!: Evidence[];
    let voteSet: VoteSet | undefined;
    if (valSet) {
      // validator size + 1(evidence list) + 1(round and POLRound list) + 1(proposal)
      if (values.length !== valSet.length + 3) {
        throw new Error('invalid values length');
      }
    }

    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (i === 0) {
        if (!isEXEvidenceList(value)) {
          throw new Error('invliad values');
        }

        const maxEvidenceCount = header._common.param('vm', 'maxEvidenceCount');
        if (typeof maxEvidenceCount !== 'number') {
          throw new Error('invalid maxEvidenceCount');
        }

        if (value.length > maxEvidenceCount) {
          throw new Error('invalid evidence count');
        }

        evidence = value.map((buf) => {
          const ev = EvidenceFactory.fromValuesArray(buf);
          return ev;
        });

        // calculate block hash
        headerHash = Reimint.calcBlockHeaderRawHash(header, evidence);
      } else if (i === 1) {
        if (!isEXRoundAndPOLRound(value)) {
          throw new Error('invliad values');
        }
        round = bufferToInt(value[0]);
        POLRound = bufferToInt(value[1]) - 1;
        if (value.length === 3) {
          commitRound = bufferToInt(value[2]);
          if (commitRound === round) {
            throw new Error('commitRound equals round, but round list length is 3');
          }
        } else {
          commitRound = round;
        }

        if (valSet) {
          // increase validator set by round
          valSet = valSet.copy();
          valSet.incrementProposerPriority(round);

          // get proposer address by round
          proposer = valSet.proposer;

          /**
           * create a vote set,
           * commitRound and valSet.round may be different,
           * but it doesn't matter,
           * because the validator voting power is same
           */
          voteSet = new VoteSet(chainId, header.number, commitRound, VoteType.Precommit, valSet);
        }
      } else if (i === 2) {
        if (!isEXVote(value)) {
          throw new Error('invliad values');
        }

        const signature = value;
        proposal = new Proposal(
          {
            round,
            POLRound,
            height: header.number,
            type: VoteType.Proposal,
            hash: headerHash
          },
          signature
        );
        if (proposer) {
          proposal.validateSignature(proposer);
        }
      } else {
        if (isEXVote(value)) {
          if (!voteSet) {
            break;
          }

          const signature = value;
          const vote = new Vote(
            {
              type: VoteType.Precommit,
              hash: headerHash,
              height: header.number,
              round: commitRound,
              index: i - 3,
              chainId
            },
            signature
          );
          const conflicting = voteSet.addVote(vote);
          if (conflicting) {
            throw new Error('conflicting vote');
          }
        } else if (!isEXEmptyVote(value)) {
          throw new Error('invliad values');
        }
      }
    }

    return new ExtraData(round, commitRound, POLRound, evidence, proposal, voteSet);
  }

  constructor(round: number, commitRound: number, POLRound: number, evidence: Evidence[], proposal: Proposal, voteSet?: VoteSet) {
    this.round = round;
    this.commitRound = commitRound;
    this.POLRound = POLRound;
    this.proposal = proposal;
    this.evidence = evidence;
    this.voteSet = voteSet;
    if (voteSet && voteSet.signedMsgType !== VoteType.Precommit) {
      throw new Error('invalid vote set type');
    }
    this.validateBasic();
  }

  raw(validaterSetSize?: number) {
    const raw: rlp.Input = [];
    raw.push(this.evidence.map((ev) => EvidenceFactory.rawEvidence(ev)));
    if (this.round === this.commitRound) {
      raw.push([intToBuffer(this.round), intToBuffer(this.POLRound + 1)]);
    } else {
      raw.push([intToBuffer(this.round), intToBuffer(this.POLRound + 1), intToBuffer(this.commitRound)]);
    }
    raw.push(this.proposal.signature!);
    if (this.voteSet) {
      for (const vote of this.voteSet.votes) {
        if (vote === undefined) {
          raw.push([]);
        } else {
          raw.push(vote.signature!);
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

  validateBasic() {
    v.validateRound(this.round);
    v.validatePOLRound(this.POLRound);
  }

  validate() {
    if (!this.voteSet || this.voteSet.voteCount() === 0 || !this.voteSet.maj23 || !this.voteSet.maj23.equals(this.proposal.hash)) {
      throw new Error('invalid vote set');
    }
  }

  async verifyEvidence(backend: ExtraDataValidateBackend, parentBlock: Block) {
    for (const ev of this.evidence) {
      if (ev instanceof DuplicateVoteEvidence) {
        const parentHeader = parentBlock.header;
        /**
         * If we use _common directly, it may cause some problems
         * when the consensus algorithm is switched
         */
        const common = backend.getCommon(ev.height);
        const stakeManager = backend.getStakeManager(await backend.getVM(parentHeader.stateRoot, common), parentBlock, common);
        const validatorSet = (await backend.validatorSets.get(parentHeader.stateRoot, stakeManager)).copy();
        validatorSet.incrementProposerPriority(ev.voteA.round);
        ev.verify(validatorSet);
      } else {
        throw new Error('unknown evidence');
      }
    }
  }
}
