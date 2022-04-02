import EventEmitter from 'events';
import { Address } from 'ethereumjs-util';
import { Block, BlockHeader, HeaderData, Transaction, Receipt } from '@rei-network/structure';
import { Common } from '@rei-network/common';
import { Channel, logger } from '@rei-network/utils';
import { Node } from '../node';
import { EMPTY_ADDRESS } from '../utils';
import { Worker } from './worker';
import { ConsensusEngine, ConsensusEngineOptions, Executor } from './types';

export abstract class BaseConsensusEngine extends EventEmitter implements ConsensusEngine {
  abstract readonly executor: Executor;
  abstract newBlock(block: Block): Promise<void>;
  abstract init(): Promise<void>;
  abstract generateGenesis(): Promise<void>;
  abstract getMiner(block: Block | BlockHeader): Address;
  abstract generatePendingBlock(headerData: HeaderData, common: Common, transactions?: Transaction[]): Block;
  abstract generateReceiptTrie(transactions: Transaction[], receipts: Receipt[]): Promise<Buffer>;

  protected abstract _tryToMintNextBlock(header: Block): Promise<void>;
  protected abstract _start(): void;
  protected abstract _abort(): Promise<void>;

  readonly node: Node;
  readonly worker: Worker;

  protected _coinbase: Address;
  protected _enable: boolean;

  protected msgLoopPromise?: Promise<void>;
  protected readonly msgQueue = new Channel<Block>({ max: 1 });

  constructor(options: ConsensusEngineOptions) {
    super();
    this.node = options.node;
    this._enable = options.enable;
    this._coinbase = options.coinbase ?? EMPTY_ADDRESS;
    this.worker = new Worker({ node: this.node, engine: this });
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
   * {@link ConsensusEngine.isStarted}
   */
  get isStarted() {
    return !!this.msgLoopPromise;
  }

  /**
   * {@link ConsensusEngine.tryToMintNextBlock}
   */
  tryToMintNextBlock(block: Block) {
    this.msgQueue.push(block);
  }

  /**
   * {@link ConsensusEngine.addTxs}
   */
  addTxs(txs: Map<Buffer, Transaction[]>) {
    return this.worker.addTxs(txs);
  }

  private async msgLoop() {
    for await (const block of this.msgQueue) {
      try {
        await this._tryToMintNextBlock(block);
      } catch (err) {
        logger.error('BaseConsensusEngine::msgLoop, catch error:', err);
      }
    }
  }

  /**
   * {@link ConsensusEngine.start}
   */
  start() {
    if (this.msgLoopPromise) {
      // ignore start
      return;
    }

    this.msgLoopPromise = this.msgLoop();
    this._start();
    this.emit('start', this);
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
}
