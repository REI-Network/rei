import EventEmitter from 'events';
import { Address } from 'ethereumjs-util';
import { RunBlockResult } from '@gxchain2-ethereumjs/vm/dist/runBlock';
import { RunTxResult } from '@gxchain2-ethereumjs/vm/dist/runTx';
import { Block, HeaderData, Transaction } from '@gxchain2/structure';
import { Common } from '@gxchain2/common';
import { Channel, logger } from '@gxchain2/utils';
import { Node } from '../node';
import { Worker } from '../worker';
import { ConsensusEngine, ConsensusEngineOptions, FinalizeOpts, ProcessBlockOpts, ProcessTxOptions } from './types';
import { EMPTY_ADDRESS } from './utils';

export abstract class BaseConsensusEngine extends EventEmitter implements ConsensusEngine {
  abstract generatePendingBlock(headerData: HeaderData, common: Common, transactions?: Transaction[]): Block;
  abstract finalize(options: FinalizeOpts): Promise<{ finalizedStateRoot: Buffer; receiptTrie: Buffer }>;
  abstract processBlock(options: ProcessBlockOpts): Promise<RunBlockResult>;
  abstract processTx(options: ProcessTxOptions): Promise<RunTxResult>;

  protected abstract _newBlock(header: Block): Promise<void>;
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
   * {@link ConsensusEngine.isStarted}
   */
  get isStarted() {
    return !!this.msgLoopPromise;
  }

  /**
   * {@link ConsensusEngine.newBlock}
   */
  newBlock(block: Block) {
    this.msgQueue.push(block);
  }

  /**
   * {@link ConsensusEngine.addTxs}
   */
  addTxs(txs: Map<Buffer, Transaction[]>) {
    return this.worker.addTxs(txs);
  }

  private async msgLoop() {
    for await (const block of this.msgQueue.generator()) {
      try {
        await this._newBlock(block);
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
