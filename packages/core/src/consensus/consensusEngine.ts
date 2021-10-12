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

  /**
   * Get miner address from block header
   * @param header- Block header
   */
  BlockHeader_miner(header: BlockHeader): Address;

  /**
   * Get miner address from block
   * @param header- Block
   */
  Block_miner(block: Block): Address;

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
   * Process the target block header, try to mint a new block after the block header
   * @param header - Target header
   */
  newBlockHeader(header: BlockHeader): void;

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
