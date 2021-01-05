import { Block as EthereumJSBlock, BlockHeader as EthereumJSBlockHeander } from '@ethereumjs/block';

export class Block extends EthereumJSBlock {}
export class BlockHeader extends EthereumJSBlockHeander {}

export { BlockBuffer, BlockHeaderBuffer, BlockBodyBuffer } from '@ethereumjs/block';
