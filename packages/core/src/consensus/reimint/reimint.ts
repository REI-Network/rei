import { toBuffer, setLengthLeft, Address, rlp, BN } from 'ethereumjs-util';
import { BaseTrie } from 'merkle-patricia-tree';
import { TxReceipt } from '@gxchain2-ethereumjs/vm/dist/types';
import { encodeReceipt } from '@gxchain2-ethereumjs/vm/dist/runBlock';
import { Common } from '@gxchain2/common';
import { Block, BlockHeader, HeaderData, CLIQUE_EXTRA_VANITY, TypedTransaction, BlockOptions } from '@gxchain2/structure';
import { ExtraData, calcBlockHeaderHash, Proposal, VoteType, VoteSet, Evidence } from './types';
import { EMPTY_EXTRA_DATA, EMPTY_ADDRESS } from '../utils';
import { Signer } from './state';

const defaultRound = 0;
const defaultPOLRound = -1;
const defaultProposalTimestamp = 0;
const defaultValidaterSetSize = 1;
const defaultEvidence = [];

export function formatHeaderData(data?: HeaderData) {
  if (data) {
    if (data.extraData) {
      const extraData = toBuffer(data.extraData);
      if (extraData.length > CLIQUE_EXTRA_VANITY) {
        data.extraData = extraData.slice(0, CLIQUE_EXTRA_VANITY);
      } else {
        data.extraData = setLengthLeft(extraData, CLIQUE_EXTRA_VANITY);
      }
    } else {
      data.extraData = EMPTY_EXTRA_DATA;
    }
  } else {
    data = { extraData: EMPTY_EXTRA_DATA };
  }
  return data;
}

export interface ReimintBlockOptions extends BlockOptions {
  // whether try to sign the block
  signer?: Signer;

  // reimint round
  round?: number;

  // POLRound, default: -1
  POLRound?: number;

  // evidence list, default: []
  evidence?: Evidence[];

  // vote set,
  // it must be a precommit vote set
  // and already have `maj23`
  voteSet?: VoteSet;

  // if voteSet is not passed in,
  // validatorSetSize must be passed in,
  // it will be used to determine the size of the validator set
  validatorSetSize?: number;

  // proposal timestamp
  proposalTimestamp?: number;
}

export interface ReimintBlockOptions_SignerExists extends Omit<ReimintBlockOptions, 'signer'> {
  signer: Signer;
}

export interface ReimintBlockOptions_SignerNotExists extends Omit<ReimintBlockOptions, 'signer'> {}

export class Reimint {
  // disable contructor
  private constructor() {}

  static getMiner(data: BlockHeader | Block): Address {
    const header = data instanceof Block ? data.header : data;
    if (header.extraData.length > CLIQUE_EXTRA_VANITY) {
      return ExtraData.fromBlockHeader(header).proposal.proposer();
    } else {
      return EMPTY_ADDRESS;
    }
  }

  static isEnableGenesisValidators(totalLockedAmount: BN, validatorCount: number, common: Common) {
    const minTotalLockedAmount = common.param('vm', 'minTotalLockedAmount');
    if (typeof minTotalLockedAmount !== 'string') {
      throw new Error('invalid minTotalLockedAmount');
    }
    if (totalLockedAmount.lt(new BN(minTotalLockedAmount))) {
      return true;
    }

    const minValidatorsCount = common.param('vm', 'minValidatorsCount');
    if (typeof minValidatorsCount !== 'number') {
      throw new Error('invalid minValidatorsCount');
    }
    if (validatorCount < minValidatorsCount) {
      return true;
    }

    return false;
  }

  /**
   * Generate receipt root after `hf1`
   * @param transactions - List of transaction
   * @param receipts - List of receipt
   * @returns Receipt root
   */
  static async genReceiptTrie(transactions: TypedTransaction[], receipts: TxReceipt[]) {
    const trie = new BaseTrie();
    for (let i = 0; i < receipts.length; i++) {
      await trie.put(rlp.encode(i), encodeReceipt(transactions[i], receipts[i]));
    }
    return trie.root;
  }

  /**
   * Generate block header, proposal and fill extra data by options
   * @param data - Block header data
   * @param options - Reimint block options
   * @returns Header and proposal
   */
  static generateBlockHeaderAndProposal(data: HeaderData, options: ReimintBlockOptions): { header: BlockHeader; proposal?: Proposal } {
    const header = BlockHeader.fromHeaderData(data, options);
    if (options.signer) {
      data = formatHeaderData(data);

      const round = options.round ?? defaultRound;
      const POLRound = options.POLRound ?? defaultPOLRound;
      const timestamp = options.proposalTimestamp ?? defaultProposalTimestamp;
      const validaterSetSize = options.validatorSetSize ?? defaultValidaterSetSize;
      const evidence = options.evidence ?? defaultEvidence;

      // calculate block hash
      const headerHash = calcBlockHeaderHash(header, round, POLRound, evidence);
      const proposal = new Proposal({
        round,
        POLRound,
        height: header.number,
        type: VoteType.Proposal,
        hash: headerHash,
        timestamp
      });
      proposal.signature = options.signer.sign(proposal.getMessageToSign());
      const extraData = new ExtraData(round, POLRound, evidence, proposal, options?.voteSet);
      return {
        header: BlockHeader.fromHeaderData({ ...data, extraData: Buffer.concat([data.extraData as Buffer, extraData.serialize(validaterSetSize)]) }, options),
        proposal
      };
    } else {
      return { header };
    }
  }

  /**
   * Generate block, proposal and fill extra data by options
   * @param data - Block data
   * @param transactions - Transactions
   * @param options - Reimint block options
   * @returns Block and proposal
   */
  static generateBlockAndProposal(data: HeaderData, transactions: TypedTransaction[], options: ReimintBlockOptions_SignerExists): { block: Block; proposal: Proposal };
  static generateBlockAndProposal(data: HeaderData, transactions: TypedTransaction[], options: ReimintBlockOptions_SignerNotExists): { block: Block };
  static generateBlockAndProposal(data: HeaderData, transactions: TypedTransaction[], options: ReimintBlockOptions): { block: Block; proposal?: Proposal };
  static generateBlockAndProposal(data: HeaderData, transactions: TypedTransaction[], options: ReimintBlockOptions): { block: Block; proposal?: Proposal } {
    const { header, proposal } = Reimint.generateBlockHeaderAndProposal(data, options);
    return { block: new Block(header, transactions, undefined, options), proposal };
  }

  /**
   * Generate block for commit
   * @param data - Block header data
   * @param transactions - Transactions
   * @param evidence - Evidence list
   * @param proposal - Proposal
   * @param votes - Precommit vote set
   * @param options - Block options
   * @returns Complete block
   */
  static generateFinalizedBlock(data: HeaderData, transactions: TypedTransaction[], evidence: Evidence[], proposal: Proposal, votes: VoteSet, options?: BlockOptions) {
    const extraData = new ExtraData(proposal.round, proposal.POLRound, evidence, proposal, votes);
    data = formatHeaderData(data);
    const header = BlockHeader.fromHeaderData({ ...data, extraData: Buffer.concat([data.extraData as Buffer, extraData.serialize()]) }, options);
    return new Block(header, transactions, undefined, options);
  }
}
