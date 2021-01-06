import { Node } from '@gxchain2/core';
import { Block, JsonBlock } from '@gxchain2/block';

export class Controller {
  node: Node;
  constructor(node: Node) {
    this.node = node;
  }

  async eth_getBlockByNumber([tag, fullTransactions]: [string, boolean]): Promise<JsonBlock> {
    let block: Block;
    if (tag === 'earliest') {
      block = await this.node.blockchain.getBlock(0);
    } else if (tag === 'latest') {
      block = this.node.blockchain.latestBlock;
    } else if (tag === 'pending') {
      throw new Error('Unsupport pending block');
    } else if (Number.isInteger(Number(tag))) {
      block = await this.node.blockchain.getBlock(Number(tag));
    } else {
      throw new Error('Invalid tag value');
    }
    return block.toJSON();
  }
}
