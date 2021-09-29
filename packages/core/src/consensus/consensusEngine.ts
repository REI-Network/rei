import { Address, BN } from 'ethereumjs-util';
import { Common } from '@gxchain2/common';
import { BlockData, HeaderData, BlockBuffer, BlockHeaderBuffer, BlockOptions, BlockHeader, Block } from '@gxchain2/structure';

export interface ConsensusEngine {
  // get current coinbase
  coinbase: Address;
  // engine enable
  enable: boolean;

  /**
   * Create a block header from values array
   * @param data - Block header buffer
   * @param options - Block options
   */
  BlockHeader_fromValuesArray(data: BlockHeaderBuffer, options?: BlockOptions): BlockHeader;

  /**
   * Create a block header from data
   * @param data - Block header data
   * @param options - Block options
   */
  BlockHeader_fromHeaderData(data: HeaderData, options?: BlockOptions): BlockHeader;

  /**
   * Create a block from values array
   * @param data - Block buffer
   * @param options - Block options
   */
  Block_fromValuesArray(data: BlockBuffer, options?: BlockOptions): Block;

  /**
   * Create a block from data
   * @param data - Block data
   * @param options - Block options
   */
  Block_fromBlockData(data: BlockData, options?: BlockOptions): Block;

  /**
   * Get gas limit by common instance
   * @param common - Common instance
   * @returns Gas limit
   */
  getGasLimitByCommon(common: Common): BN;

  /**
   * Get pending block header
   * @param data - Block header data
   * @returns Pending block header
   */
  getPendingBlockHeader(data: HeaderData): BlockHeader;

  /**
   * Get the last pending block
   * @returns Pending block
   */
  getPendingBlock(): Promise<Block>;
}
