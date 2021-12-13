import { Address } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { HeaderData, Block, Transaction, Receipt } from '@rei-network/structure';
import { Node } from '../node';
import { Worker } from '../worker';

export enum ConsensusType {
  Clique,
  Reimint
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
   * Generate receipt trie
   * @param transactions - Transactions
   * @param receipts - Receipts
   */
  generateReceiptTrie(transactions: Transaction[], receipts: Receipt[]): Promise<Buffer>;
}
