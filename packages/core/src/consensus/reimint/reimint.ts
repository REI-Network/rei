import { Address, BN, toBuffer, setLengthLeft, KECCAK256_RLP_ARRAY } from 'ethereumjs-util';
import { Block, BlockHeader, HeaderData, CLIQUE_EXTRA_VANITY, TypedTransaction, BlockOptions } from '@gxchain2/structure';
import { logger } from '@gxchain2/utils';
import { ConsensusEngine, ConsensusEngineOptions } from '../consensusEngine';
import { EMPTY_ADDRESS, EMPTY_EXTRA_DATA } from '../utils';
import { ConsensusEngineBase } from '../consensusEngineBase';
import { ExtraData, calcBlockHeaderHash } from './extraData';
import { Proposal } from './proposal';
import { StateMachine } from './state';
import { VoteType, VoteSet } from './vote';

const defaultRound = 0;
const defaultPOLRound = -1;
const defaultProposalTimestamp = 0;
const defaultValidaterSetSize = 1;

export interface ReimintBlockOptions extends BlockOptions {
  // whether try to sign the block,
  // default: true
  sign?: boolean;

  // reimint round
  round?: number;

  // POLRound, default: -1
  POLRound?: number;

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

export class ReimintConsensusEngine extends ConsensusEngineBase implements ConsensusEngine {
  private state: StateMachine;

  constructor(options: ConsensusEngineOptions) {
    super(options);
    this.state = new StateMachine(options.node, this);
  }

  /////////////////////////////////

  /**
   * {@link ConsensusEngine.BlockHeader_miner}
   */
  BlockHeader_miner(header: BlockHeader) {
    if (header.extraData.length > CLIQUE_EXTRA_VANITY) {
      return ExtraData.fromBlockHeader(header).proposal.proposer();
    } else {
      return EMPTY_ADDRESS;
    }
  }

  /**
   * {@link ConsensusEngine.Block_miner}
   */
  Block_miner(block: Block): Address {
    return this.BlockHeader_miner(block.header);
  }

  /**
   * {@link ConsensusEngine.getPendingBlockHeader}
   */
  getPendingBlockHeader({ number, parentHash, timestamp }: HeaderData): BlockHeader {
    if (number === undefined || !(number instanceof BN)) {
      throw new Error('invalid header data');
    }

    const common = this.node.getCommon(number);
    const { header } = this.generateBlockHeaderAndProposal(
      {
        parentHash,
        uncleHash: KECCAK256_RLP_ARRAY,
        coinbase: EMPTY_ADDRESS,
        number,
        timestamp,
        difficulty: new BN(1),
        gasLimit: this.getGasLimitByCommon(common)
      },
      { common }
    );
    return header;
  }

  //////////////////////////

  protected _start() {
    this.state.start();
  }

  protected async _abort() {
    await this.state.abort();
  }

  /**
   * Process a new block header, try to mint a block after this block
   * @param header - New block header
   */
  protected async _newBlockHeader(header: BlockHeader) {
    if (!this.enable || this.node.sync.isSyncing) {
      return;
    }

    // create a new pending block through worker
    await this.worker.newBlockHeader(header);
    if (!this.enable || this.node.sync.isSyncing) {
      return;
    }

    let validators = this.node.validatorSets.directlyGet(header.stateRoot);
    // if the validator set doesn't exist, return
    if (!validators) {
      logger.warn('ReimintConsensusEngine::_newBlockHeader, missing validators');
      return;
    }

    this.state.newBlockHeader(header, validators);
  }

  /**
   * Generate block header, proposal and fill extra data by options
   * @param data - Block header data
   * @param options - Reimint block options
   * @returns Header and proposal
   */
  generateBlockHeaderAndProposal(data?: HeaderData, options?: ReimintBlockOptions): { header: BlockHeader; proposal?: Proposal } {
    const header = BlockHeader.fromHeaderData(data, options);
    const sign = options?.sign ?? true;

    if (sign && this.enable) {
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

      const round = options?.round ?? defaultRound;
      const POLRound = options?.POLRound ?? defaultPOLRound;
      const timestamp = options?.proposalTimestamp ?? defaultProposalTimestamp;
      const validaterSetSize = options?.validatorSetSize ?? defaultValidaterSetSize;

      // calculate block hash
      const headerHash = calcBlockHeaderHash(header, round, POLRound);
      const proposal = new Proposal({
        round,
        POLRound,
        height: header.number,
        type: VoteType.Proposal,
        hash: headerHash,
        timestamp
      });
      proposal.sign(this.node.accMngr.getPrivateKey(this.coinbase));
      const extraData = new ExtraData(round, POLRound, proposal, options?.voteSet);
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
  generateBlockAndProposal(data?: HeaderData, transactions?: TypedTransaction[], options?: ReimintBlockOptions): { block: Block; proposal?: Proposal } {
    const { header, proposal } = this.generateBlockHeaderAndProposal(data, options);
    return { block: new Block(header, transactions, undefined, { common: header._common }), proposal };
  }
}
