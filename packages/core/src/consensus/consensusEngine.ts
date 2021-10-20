import { Address, BN } from 'ethereumjs-util';
import { Common } from '@gxchain2/common';
import { BlockData, HeaderData, BlockHeader, Block, Transaction } from '@gxchain2/structure';
import { Node } from '../node';

export interface ConsensusEngineOptions {
  node: Node;
  enable: boolean;
  coinbase?: Address;
}

export interface ConsensusEngineConstructor {
  new (options: ConsensusEngineOptions): ConsensusEngine;
}

export interface ConsensusEngine {
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
   * Get miner address from block header or block
   * @param header - Block header or block
   */
  getMiner(data: BlockHeader | Block): Address;

  /**
   * Get gas limit by common instance
   * @param common - Common instance
   * @returns Gas limit
   */
  getGasLimitByCommon(common: Common): BN;

  /**
   * Get pending block header for worker
   * @param data - Block header data
   * @returns Pending block header
   */
  getPendingBlockHeader(data: HeaderData): BlockHeader;

  /**
   * Get pending block for worker
   * @param data - Block data
   * @returns Pending block
   */
  getPendingBlock(data: BlockData): Block;

  /**
   * Get the last pending block
   * @returns Pending block
   */
  getLastPendingBlock(): Block;

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
}
