import { Address, BN } from 'ethereumjs-util';
import { Common } from '@gxchain2/common';
import { BlockData, HeaderData, BlockBuffer, BlockHeaderBuffer, BlockOptions, BlockHeader, Block } from '@gxchain2/structure';

export interface ConsensusEngine {
  coinbase: Address;
  enable: boolean;
  BlockHeader_fromValuesArray(data: BlockHeaderBuffer, options?: BlockOptions): BlockHeader;
  BlockHeader_fromHeaderData(data: HeaderData, options?: BlockOptions): BlockHeader;
  Block_fromValuesArray(data: BlockBuffer, options?: BlockOptions): Block;
  Block_fromBlockData(data: BlockData, options?: BlockOptions): Block;
  getGasLimitByCommon(common: Common): BN;
}
