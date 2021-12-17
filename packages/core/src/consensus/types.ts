import { Address, BNLike, BN } from 'ethereumjs-util';
import VM from '@gxchain2-ethereumjs/vm';
import { DefaultStateManager as StateManager } from '@gxchain2-ethereumjs/vm/dist/state';
import Bloom from '@gxchain2-ethereumjs/vm/dist/bloom';
import { IDebug } from '@gxchain2-ethereumjs/vm/dist/types';
import { Common } from '@rei-network/common';
import { HeaderData, Block, Transaction, Receipt, TypedTransaction, BlockHeader } from '@rei-network/structure';
import { Blockchain } from '@rei-network/blockchain';
import { Database } from '@rei-network/database';
import { Node } from '../node';
import { Worker } from './worker';
import { Evidence } from './reimint/evpool';

export enum ConsensusType {
  Clique,
  Reimint
}

export interface ConsensusEngineOptions {
  node: Node;
  enable: boolean;
  coinbase?: Address;
}

export interface ConsensusEngine {
  // worker instance
  readonly worker: Worker;
  // executor instance
  readonly executor: Executor;
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
   * Try to mint a block after this block
   * @param block - New block
   */
  tryToMintNextBlock(block: Block): void;

  /**
   * Process the new block
   * @param block - New block
   */
  newBlock(block: Block): Promise<void>;

  /**
   * Add pending transactions to worker
   * @param txs - Pending transactions
   */
  addTxs(txs: Map<Buffer, Transaction[]>): Promise<void>;

  /**
   * Init engine
   */
  init(): Promise<void>;

  /**
   * Start working
   */
  start(): void;

  /**
   * Stop working
   */
  abort(): Promise<void>;

  /**
   * Generate genesis state
   */
  generateGenesis(): Promise<void>;

  /**
   * Get miner address
   * @param block - Block or block header
   */
  getMiner(block: Block | BlockHeader): Address;

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
   * Generate receipt trie
   * @param transactions - Transactions
   * @param receipts - Receipts
   */
  generateReceiptTrie(transactions: Transaction[], receipts: Receipt[]): Promise<Buffer>;
}

export interface FinalizeOpts {
  block: Block;
  stateRoot: Buffer;
  receipts: Receipt[];

  round?: number;
  evidence?: Evidence[];
  parentStateRoot?: Buffer;
}

export interface FinalizeResult {
  finalizedStateRoot: Buffer;
}

export interface ProcessBlockOpts {
  block: Block;
  debug?: IDebug;
  skipConsensusValidation?: boolean;
  skipConsensusVerify?: boolean;
}

export interface ProcessBlockResult {
  receipts: Receipt[];
}

export interface ProcessTxOpts {
  block: Block;
  root: Buffer;
  tx: TypedTransaction;
  blockGasUsed?: BN;
}

export interface ProcessTxResult {
  receipt: Receipt;
  gasUsed: BN;
  bloom: Bloom;
  root: Buffer;
}

export interface ExecutorBackend {
  readonly db: Database;
  readonly blockchain: Blockchain;
  getCommon(num: BNLike): Common;
  getStateManager(root: Buffer, num: BNLike | Common): Promise<StateManager>;
  getVM(root: Buffer, num: BNLike | Common): Promise<VM>;
}

export interface Executor {
  /**
   * Finalize a pending block,
   * assign block reward to miner and
   * do other things(afterApply) and
   * calculate finalized state root
   * @param options - Finalize options
   * @return FinalizeResult
   */
  finalize(options: FinalizeOpts): Promise<FinalizeResult>;

  /**
   * Process a block
   * @param options - Process block options
   * @returns ProcessBlockResult
   */
  processBlock(options: ProcessBlockOpts): Promise<ProcessBlockResult>;

  /**
   * Process transaction
   * @param options - Process transaction options
   * @returns ProcessTxResult
   */
  processTx(options: ProcessTxOpts): Promise<ProcessTxResult>;
}
