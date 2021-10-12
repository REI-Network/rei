import { Address, BN } from 'ethereumjs-util';
import { BlockHeader, Block, HeaderData, BlockData } from '@gxchain2-ethereumjs/block';
import { TypedTransaction, TransactionFactory } from '@gxchain2/structure';
import { Transaction } from '@gxchain2-ethereumjs/tx';
import { Common } from '@gxchain2/common';
import { hexStringToBN, Channel, logger } from '@gxchain2/utils';
import { Node } from '../node';
import { Worker } from '../worker';
import { ConsensusEngine, ConsensusEngineOptions } from './consensusEngine';
import { EMPTY_ADDRESS } from './utils';

export abstract class ConsensusEngineBase implements ConsensusEngine {
  abstract BlockHeader_miner(header: BlockHeader): Address;
  abstract Block_miner(block: Block): Address;
  abstract getPendingBlockHeader(data: HeaderData): BlockHeader;

  protected abstract _newBlockHeader(header: BlockHeader): Promise<void>;
  protected abstract _start(): void;
  protected abstract _abort(): Promise<void>;

  protected _coinbase: Address;
  protected _enable: boolean;
  protected readonly node: Node;
  protected readonly worker: Worker;
  protected msgLoopPromise?: Promise<void>;
  protected readonly msgQueue = new Channel<BlockHeader>({ max: 1 });

  constructor(options: ConsensusEngineOptions) {
    this.node = options.node;
    this._enable = options.enable;
    this._coinbase = options.coinbase ?? EMPTY_ADDRESS;
    this.worker = new Worker({ node: this.node, consensusEngine: this });
  }

  /**
   * {@link ConsensusEngine.coinbase}
   */
  get coinbase() {
    return this._coinbase;
  }

  /**
   * {@link ConsensusEngine.enable}
   */
  get enable() {
    return this._enable && !this._coinbase.equals(EMPTY_ADDRESS) && this.node.accMngr.hasUnlockedAccount(this._coinbase);
  }

  /**
   * {@link ConsensusEngine.newBlockHeader}
   */
  newBlockHeader(header: BlockHeader) {
    this.msgQueue.push(header);
  }

  /**
   * {@link ConsensusEngine.addTxs}
   */
  addTxs(txs: Map<Buffer, Transaction[]>) {
    return this.worker.addTxs(txs);
  }

  private async msgLoop() {
    for await (const header of this.msgQueue.generator()) {
      try {
        await this._newBlockHeader(header);
      } catch (err) {
        logger.error('ConsensusEngineBase::msgLoop, catch error:', err);
      }
    }
  }

  /**
   * {@link ConsensusEngine.start}
   */
  start() {
    if (this.msgLoopPromise) {
      throw new Error('CliqueConsensusEngine has started');
    }

    this.msgLoopPromise = this.msgLoop();
  }

  /**
   * {@link ConsensusEngine.abort}
   */
  async abort() {
    if (this.msgLoopPromise) {
      this.msgQueue.abort();
      await this.msgLoopPromise;
      this.msgLoopPromise = undefined;
      await this._abort();
    }
  }

  /**
   * {@link ConsensusEngine.getGasLimitByCommon}
   */
  getGasLimitByCommon(common: Common): BN {
    const limit = common.param('vm', 'gasLimit');
    return hexStringToBN(limit === null ? common.genesis().gasLimit : limit);
  }

  /**
   * {@link ConsensusEngine.getPendingBlock}
   */
  getPendingBlock(data: BlockData): Block {
    if (!data.header) {
      throw new Error('invalid block data');
    }

    const header = this.getPendingBlockHeader(data.header);
    const transactions: TypedTransaction[] = [];
    const txsData = data?.transactions ?? [];
    for (const txData of txsData) {
      const tx = TransactionFactory.fromTxData(txData, { common: header._common });
      transactions.push(tx);
    }
    return new Block(header, transactions, undefined, { common: header._common });
  }

  /**
   * {@link ConsensusEngine.getLastPendingBlock}
   */
  getLastPendingBlock() {
    const pendingBlock = this.worker.getLastPendingBlock();
    return pendingBlock ?? this.getPendingBlock({});
  }
}
