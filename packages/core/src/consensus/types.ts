import { Address } from 'ethereumjs-util';
import VM from '@gxchain2-ethereumjs/vm';
import { RunBlockOpts, RunBlockResult } from '@gxchain2-ethereumjs/vm/dist/runBlock';
import { RunTxOpts, RunTxResult } from '@gxchain2-ethereumjs/vm/dist/runTx';
import { TxReceipt } from '@gxchain2-ethereumjs/vm/dist/types';
import { Common } from '@gxchain2/common';
import { HeaderData, Block, TypedTransaction, Transaction } from '@gxchain2/structure';
import { Node } from '../node';
import { Worker } from '../worker';
import { ValidatorSet } from '../staking';

export enum ConsensusType {
  Clique,
  Reimint
}

export interface FinalizeOpts {
  block: Block;
  stateRoot: Buffer;
  transactions: TypedTransaction[];
  receipts: TxReceipt[];

  round?: number;
  parentStateRoot?: Buffer;
}

export interface ProcessBlockOpts extends Pick<RunBlockOpts, 'block' | 'runTxOpts' | 'root'> {
  root: Buffer;

  skipConsensusValidation?: boolean;
}

export interface ProcessBlockResult extends RunBlockResult {
  validatorSet?: ValidatorSet;
}

export interface ProcessTxOptions extends Omit<RunTxOpts, 'block' | 'beforeTx' | 'afterTx' | 'assignTxReward' | 'generateTxReceipt' | 'skipBalance'> {
  block: Block;
  vm: VM;
}

export interface ConsensusEngineOptions {
  node: Node;
  enable: boolean;
  coinbase?: Address;
}

export interface ConsensusEngineConstructor {
  new (options: ConsensusEngineOptions): ConsensusEngine;
}

export interface ConsensusEngine {
  // worker instance
  readonly worker: Worker;
  // get current coinbase
  coinbase: Address;
  // engine enable
  enable: boolean;
  // engine is started
  isStarted: boolean;

  /**
   * Register event listener,
   * emit the callback when engine is started
   * @param event - Event name
   * @param cb - Callback
   */
  on(event: 'start', cb: (engine: ConsensusEngine) => void): ConsensusEngine;

  /**
   * Remove event listener
   * @param event - Event name
   * @param cb - Callback
   */
  off(event: 'start', cb: (engine: ConsensusEngine) => void): ConsensusEngine;

  /**
   * Process a new block, try to mint a block after this block
   * @param block - New block
   */
  newBlock(block: Block): void;

  /**
   * Add pending transactions to worker
   * @param txs - Pending transactions
   */
  addTxs(txs: Map<Buffer, Transaction[]>): Promise<void>;

  /**
   * Start working
   */
  start(): void;

  /**
   * Stop working
   */
  abort(): Promise<void>;

  /**
   * Create a simple signed block by data,
   * the header data can be incompleted,
   * because the block created is only to
   * ensure that the correct miner can be obtained during `processTx`
   * @param data - Header data
   * @param common - Common instance
   * @param transactions - List of transaction
   * @returns Block
   */
  generatePendingBlock(headerData: HeaderData, common: Common, transactions?: Transaction[]): Block;

  /**
   * Finalize a pending block,
   * assign block reward to miner and
   * do other things(afterApply) and
   * calculate finalized state root and
   * receipt trie
   * @param options - Finalize options
   * @return FinalizedStateRoot and receiptTrie
   */
  finalize(options: FinalizeOpts): Promise<{ finalizedStateRoot: Buffer; receiptTrie: Buffer }>;

  /**
   * Process a block
   * @param options - Process block options
   * @returns ProcessBlockResult
   */
  processBlock(options: ProcessBlockOpts): Promise<ProcessBlockResult>;

  /**
   * Process transaction
   * @param options - Process transaction options
   * @returns RunTxResult
   */
  processTx(options: ProcessTxOptions): Promise<RunTxResult>;
}
