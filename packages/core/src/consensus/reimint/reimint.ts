import { Address, BN, toBuffer, setLengthLeft } from 'ethereumjs-util';
import { Block, BlockHeader, BlockData, HeaderData, BlockBuffer, BlockHeaderBuffer, CLIQUE_EXTRA_VANITY, TransactionFactory, TypedTransaction, TxOptions, Transaction } from '@gxchain2/structure';
import { Common } from '@gxchain2/common';
import { hexStringToBN, Channel, logger } from '@gxchain2/utils';
import { ConsensusEngine, ConsensusEngineOptions, CEBlockOptions } from '../consensusEngine';
import { Node } from '../../node';
import { Worker } from '../../worker';
import { EMPTY_ADDRESS, EMPTY_EXTRA_DATA } from './utils';
import { ExtraData, calcBlockHeaderHash } from './extraData';
import { Proposal } from './proposal';
import { StateMachine } from './state';
import { VoteType } from './vote';

const defaultRound = 0;
const defaultPOLRound = -1;
const defaultProposalTimestamp = 0;
const defaultValidaterSetSize = 1;

export class ReimintConsensusEngine implements ConsensusEngine {
  private worker: Worker;
  private node: Node;
  private msgQueue = new Channel<BlockHeader>({ max: 1 });
  private msgLoopPromise?: Promise<void>;
  private state: StateMachine;
  private _coinbase: Address;
  private _enable: boolean;

  constructor(options: ConsensusEngineOptions) {
    this.node = options.node;
    this._enable = options.enable;
    this._coinbase = options.coinbase ?? EMPTY_ADDRESS;
    this.worker = new Worker({ node: this.node, consensusEngine: this });
    this.state = new StateMachine(options.node, this);
  }

  get coinbase() {
    return this._coinbase;
  }

  get enable() {
    return this._enable && !this._coinbase.equals(EMPTY_ADDRESS) && this.node.accMngr.hasUnlockedAccount(this._coinbase);
  }

  BlockHeader_miner(header: BlockHeader) {
    if (header.extraData.length > CLIQUE_EXTRA_VANITY) {
      return ExtraData.fromBlockHeader(header).proposal.proposer();
    } else {
      return EMPTY_ADDRESS;
    }
  }

  BlockHeader_fromValuesArray(values: BlockHeaderBuffer, options?: CEBlockOptions): BlockHeader {
    const [parentHash, uncleHash, coinbase, stateRoot, transactionsTrie, receiptTrie, bloom, difficulty, number, gasLimit, gasUsed, timestamp, extraData, mixHash, nonce] = values;

    if (values.length > 16) {
      throw new Error('invalid header. More values than expected were received');
    }
    if (values.length < 15) {
      throw new Error('invalid header. Less values than expected were received');
    }

    return this.BlockHeader_fromHeaderData(
      {
        parentHash,
        uncleHash,
        coinbase,
        stateRoot,
        transactionsTrie,
        receiptTrie,
        bloom,
        difficulty,
        number,
        gasLimit,
        gasUsed,
        timestamp,
        extraData,
        mixHash,
        nonce
      },
      options
    );
  }

  BlockHeader_fromHeaderData(data?: HeaderData, options?: CEBlockOptions): BlockHeader {
    const { header } = this.generateBlockHeaderAndProposal(data, options);
    return header;
  }

  Block_miner(block: Block): Address {
    return this.BlockHeader_miner(block.header);
  }

  Block_fromValuesArray(values: BlockBuffer, options?: CEBlockOptions): Block {
    const [headerBuffer, transactionBuffer] = values;
    const header = this.BlockHeader_fromValuesArray(headerBuffer, options);
    const transactions: TypedTransaction[] = [];
    for (const txData of transactionBuffer ?? []) {
      const tx = TransactionFactory.fromBlockBodyData(txData, {
        ...options,
        // Use header common in case of hardforkByBlockNumber being activated
        common: header._common
      } as TxOptions);
      transactions.push(tx);
    }
    return new Block(header, transactions, undefined, options);
  }

  Block_fromBlockData(data: BlockData, options?: CEBlockOptions): Block {
    const header = this.BlockHeader_fromHeaderData(data.header, options);
    const transactions: TypedTransaction[] = [];
    const txsData = data?.transactions ?? [];
    for (const txData of txsData) {
      const tx = TransactionFactory.fromTxData(txData, { ...options, common: header._common });
      transactions.push(tx);
    }
    return new Block(header, transactions, undefined, options);
  }

  getGasLimitByCommon(common: Common): BN {
    const limit = common.param('vm', 'gasLimit');
    return hexStringToBN(limit === null ? common.genesis().gasLimit : limit);
  }

  getEmptyPendingBlockHeader(data: HeaderData): BlockHeader {
    const common = this.node.getCommon(data?.number ?? new BN(0));
    return this.BlockHeader_fromHeaderData(data, { common });
  }

  getLastPendingBlock() {
    const pendingBlock = this.worker.getLastPendingBlock();
    return pendingBlock ?? this.Block_fromBlockData({}, { common: this.node.getCommon(0) });
  }

  //////////////////////////

  newBlockHeader(header: BlockHeader) {
    this.msgQueue.push(header);
  }

  addTxs(txs: Map<Buffer, Transaction[]>) {
    return this.worker.addTxs(txs);
  }

  start() {
    if (this.msgLoopPromise) {
      throw new Error('ReimintConsensusEngine has started');
    }

    this.msgLoopPromise = this.msgLoop();
    this.state.start();
  }

  async abort() {
    if (this.msgLoopPromise) {
      this.msgQueue.abort();
      await this.msgLoopPromise;
      this.msgLoopPromise = undefined;
      await this.state.abort();
    }
  }

  private async msgLoop() {
    for await (const header of this.msgQueue.generator()) {
      try {
        await this._newBlockHeader(header);
      } catch (err) {
        logger.error('ReimintConsensusEngine::msgLoop, catch error:', err);
      }
    }
  }

  private async _newBlockHeader(header: BlockHeader) {
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

  generateBlockHeaderAndProposal(data?: HeaderData, options?: CEBlockOptions): { header: BlockHeader; proposal?: Proposal } {
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

  generateBlockAndProposal(data?: HeaderData, transactions?: TypedTransaction[], options?: CEBlockOptions): { block: Block; proposal?: Proposal } {
    const { header, proposal } = this.generateBlockHeaderAndProposal(data, options);
    return { block: new Block(header, transactions, undefined, { common: header._common }), proposal: proposal };
  }
}
