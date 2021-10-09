import { Address, BN } from 'ethereumjs-util';
import { Common } from '@gxchain2/common';
import { BlockData, HeaderData, BlockBuffer, BlockHeaderBuffer, BlockOptions, BlockHeader, Block, Transaction } from '@gxchain2/structure';
import { VoteSet } from './reimint/vote';
import { Node } from '../node';

export interface CEBlockOptions extends BlockOptions {
  sign?: boolean;

  round?: number;
  POLRound?: number;
  voteSet?: VoteSet;
  validatorSetSize?: number;
  proposalTimestamp?: number;
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
   * Create a block header from values array
   * @param data - Block header buffer
   * @param options - Block options
   */
  BlockHeader_fromValuesArray(data: BlockHeaderBuffer, options?: CEBlockOptions): BlockHeader;

  /**
   * Create a block header from data
   * @param data - Block header data
   * @param options - Block options
   */
  BlockHeader_fromHeaderData(data: HeaderData, options?: CEBlockOptions): BlockHeader;

  /**
   * Get miner address from block
   * @param header- Block
   */
  Block_miner(block: Block): Address;

  /**
   * Create a block from values array
   * @param data - Block buffer
   * @param options - Block options
   */
  Block_fromValuesArray(data: BlockBuffer, options?: CEBlockOptions): Block;

  /**
   * Create a block from data
   * @param data - Block data
   * @param options - Block options
   */
  Block_fromBlockData(data: BlockData, options?: CEBlockOptions): Block;

  /**
   * Get gas limit by common instance
   * @param common - Common instance
   * @returns Gas limit
   */
  getGasLimitByCommon(common: Common): BN;

  /**
   * Get empty pending block header for worker
   * @param data - Block header data
   * @returns Empty pending block header
   */
  getEmptyPendingBlockHeader(data: HeaderData): BlockHeader;

  /**
   * Get the last pending block
   * @returns Pending block
   */
  getLastPendingBlock(): Block;

  newBlockHeader(header: BlockHeader): void;

  addTxs(txs: Map<Buffer, Transaction[]>): Promise<void>;

  abort(): Promise<void>;
}
