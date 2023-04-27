import { rlp, intToBuffer, bufferToInt, BNLike, Address, bnToUnpaddedBuffer, BN, rlphash } from 'ethereumjs-util';
import { VM } from '@rei-network/vm';
import { Common } from '@rei-network/common';
import { Database } from '@rei-network/database';
import { BlockHeader, CLIQUE_EXTRA_VANITY } from '@rei-network/structure';
import { isEnableDAO } from '../../hardforks';
import { ActiveValidatorSet } from './validatorSet';
import { Evidence, DuplicateVoteEvidence, EvidenceFactory } from './evpool';
import { BitArray, Reimint } from '../reimint';
import { Vote, VoteType, VoteSet, SignatureType } from './vote';
import { Proposal } from './proposal';
import * as v from './validate';
import { ReimintConsensusEngine } from './engine';

export interface ExtraDataOptions {
  chainId: number;
  header: BlockHeader;
  valSet?: ActiveValidatorSet;
}

// TODO: add bls public key, remove the interface
export interface ExtraDataFromBlockHeaderOptions extends Omit<ExtraDataOptions, 'header' | 'chainId'> {}

export type EXVote = Buffer;
export type EXEmptyVote = [];
export type EXRoundAndPOLRound = [Buffer, Buffer] | [Buffer, Buffer, Buffer];
export type EXEvidenceList = (Buffer | Buffer[])[];
export type EXVoteSetBitArray = (Buffer | Buffer[])[];
export type EXAggregateSignature = Buffer;
export type EXElement = EXEmptyVote | EXVote | EXRoundAndPOLRound | EXEvidenceList | EXVoteSetBitArray;
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
function isEXVoteSetBitArray(ele: EXElement): ele is EXVoteSetBitArray {
  if (Array.isArray(ele) && ele.length === 2 && ele[0] instanceof Buffer && Array.isArray(ele[1])) {
    return ele[1].every((item) => item instanceof Buffer);
  } else {
    return false;
  }
}

function isEXAggregatedSignature(ele: EXElement): ele is EXAggregateSignature {
  return ele instanceof Buffer;
}

export interface ExtraDataValidateBackend {
  readonly db: Database;
  getCommon(num: BNLike): Common;
  getVM(root: Buffer, num: BNLike | Common): Promise<VM>;
}

export interface ExtraDataVoteInfo {
  chainId: number;
  type: VoteType;
  height: BN;
  round: number;
  hash: Buffer;
}
export interface ExtraDataValidateOptions {
  validaterSetSize?: number;
}

export class ExtraData {
  readonly evidence: Evidence[];
  readonly round: number;
  readonly commitRound: number;
  readonly POLRound: number;
  readonly proposal: Proposal;
  readonly version: SignatureType;
  readonly voteSet?: VoteSet;

  /**
   * New ExtraData from BlockHeader
   * @param header - BlockHeader
   * @param options - validator set
   * @returns ExtraData
   */
  static fromBlockHeader(header: BlockHeader, options?: ExtraDataFromBlockHeaderOptions) {
    if (header.extraData.length <= CLIQUE_EXTRA_VANITY) {
      throw new Error('invalid header');
    }
    return ExtraData.fromSerializedData(header.extraData.slice(CLIQUE_EXTRA_VANITY), { ...options, header, chainId: header._common.chainIdBN().toNumber() });
  }

  /**
   * New ExtraData from serialized data
   * @param serialized - serialized data
   * @param options - ExtraDataOptions
   * @returns ExtraData
   */
  static fromSerializedData(serialized: Buffer, options: ExtraDataOptions) {
    const values = rlp.decode(serialized) as unknown as EXElements;
    if (!Array.isArray(values)) {
      throw new Error('invalid serialized value');
    }
    return ExtraData.fromValuesArray(values, options);
  }

  /**
   * New ExtraData from values array
   * @param values - values array
   * @param ExtraDataOptions
   * @returns ExtraData
   */
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
    let blsAggregateSignature: Buffer | undefined;
    const signatureType = isEnableDAO(header._common) ? SignatureType.BLS : SignatureType.ECDSA;
    if (signatureType === SignatureType.BLS) {
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
            voteSet = new VoteSet(chainId, header.number, commitRound, VoteType.Precommit, valSet, signatureType);
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
        } else if (i === 3) {
          if (!isEXAggregatedSignature(value)) {
            throw new Error('invliad values');
          }
          blsAggregateSignature = value;
        } else if (i === 4) {
          if (!isEXVoteSetBitArray(value)) {
            throw new Error('invliad values');
          }

          if (valSet) {
            const bitArray = BitArray.fromValuesArray(value);
            const voteInfo = {
              chainId: chainId,
              type: VoteType.Precommit,
              hash: headerHash,
              height: header.number,
              round: commitRound
            };
            const msgHash = rlphash([intToBuffer(voteInfo.chainId), intToBuffer(voteInfo.type), bnToUnpaddedBuffer(voteInfo.height), intToBuffer(voteInfo.round), voteInfo.hash]);
            voteSet!.setAggregatedSignature(blsAggregateSignature!, bitArray, msgHash, voteInfo!.hash);
          }
        } else {
          throw new Error('invliad values');
        }
      }
      return new ExtraData(round, commitRound, POLRound, evidence, proposal, signatureType, voteSet);
    } else {
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
            voteSet = new VoteSet(chainId, header.number, commitRound, VoteType.Precommit, valSet, signatureType);
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
              signatureType,
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
      return new ExtraData(round, commitRound, POLRound, evidence, proposal, signatureType, voteSet);
    }
  }

  constructor(round: number, commitRound: number, POLRound: number, evidence: Evidence[], proposal: Proposal, version: SignatureType, voteSet?: VoteSet) {
    if (voteSet && voteSet.signedMsgType !== VoteType.Precommit) {
      throw new Error('invalid vote set type');
    }

    this.round = round;
    this.commitRound = commitRound;
    this.POLRound = POLRound;
    this.proposal = proposal;
    this.evidence = evidence;
    this.voteSet = voteSet;
    this.version = version;
    this.validateBasic();
  }

  /**
   * Generate raw extra data
   * @param validaterOptions - validater options
   * @returns
   */
  raw(validaterOptions?: ExtraDataValidateOptions) {
    const raw: rlp.Input = [];
    raw.push(this.evidence.map((ev) => EvidenceFactory.rawEvidence(ev)));
    if (this.round === this.commitRound) {
      raw.push([intToBuffer(this.round), intToBuffer(this.POLRound + 1)]);
    } else {
      raw.push([intToBuffer(this.round), intToBuffer(this.POLRound + 1), intToBuffer(this.commitRound)]);
    }
    raw.push(this.proposal.signature!);
    if (this.version === SignatureType.ECDSA) {
      if (this.voteSet) {
        const maj23Hash = this.voteSet.maj23!;
        for (const vote of this.voteSet.votes) {
          if (vote === undefined || !vote.hash.equals(maj23Hash)) {
            raw.push([]);
          } else {
            raw.push(vote.signature!);
          }
        }
      } else {
        if (validaterOptions?.validaterSetSize === undefined) {
          throw new Error('missing validater set size');
        }
        for (let i = 0; i < validaterOptions.validaterSetSize; i++) {
          raw.push([]);
        }
      }
    } else {
      if (this.voteSet) {
        raw.push(this.voteSet.getAggregatedSignature());
        raw.push(this.voteSet.votesBitArray.raw());
      } else {
        raw.push(Buffer.alloc(0));
        if (validaterOptions?.validaterSetSize === undefined) {
          throw new Error('missing validater set size');
        }
        const bitArray = new BitArray(validaterOptions.validaterSetSize);
        raw.push(bitArray.raw());
      }
    }
    return raw;
  }

  /**
   * Generate serialized extra data
   * @param validaterOptions - validater options
   * @returns
   */
  serialize(validaterOptions?: ExtraDataValidateOptions) {
    return rlp.encode(this.raw(validaterOptions));
  }

  /**
   * Get active validator set
   * @returns active validator set
   */
  activeValidatorSet() {
    return this.voteSet?.valSet;
  }

  /**
   * Validate extra data round and POLRound
   */
  validateBasic() {
    v.validateRound(this.round);
    v.validatePOLRound(this.POLRound);
  }

  /**
   * Validate extra data
   */
  validate() {
    if (this.version === SignatureType.ECDSA) {
      if (!this.voteSet || this.voteSet.voteCount() === 0 || !this.voteSet.maj23 || !this.voteSet.maj23.equals(this.proposal.hash)) {
        throw new Error('invalid vote set');
      }
    } else if (this.version === SignatureType.BLS) {
      if (!this.voteSet || !this.voteSet.maj23 || !this.voteSet.maj23.equals(this.proposal.hash)) {
        throw new Error('invalid vote set');
      }
    } else {
      throw new Error(`unknown version: ${this.version}`);
    }
  }

  /**
   * Verify evidence in extradata
   * @param backend - backend
   * @param engine - consensus engine
   */
  async verifyEvidence(backend: ExtraDataValidateBackend, engine: ReimintConsensusEngine) {
    for (const ev of this.evidence) {
      if (ev instanceof DuplicateVoteEvidence) {
        const parentBlock = await backend.db.getBlock(ev.height.subn(1));
        const parentHeader = parentBlock.header;

        /**
         * If we use _common directly, it may cause some problems
         * when the consensus algorithm is switched
         */
        const common = backend.getCommon(ev.height);
        const stakeManager = engine.getStakeManager(await backend.getVM(parentHeader.stateRoot, common), parentBlock, common);
        const validatorSet = (await engine.validatorSets.getActiveValSet(parentHeader.stateRoot, stakeManager)).copy();
        validatorSet.incrementProposerPriority(ev.voteA.round);
        ev.verify(validatorSet);
      } else {
        throw new Error('unknown evidence');
      }
    }
  }
}
