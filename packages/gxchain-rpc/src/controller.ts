import { Node } from '@gxchain2/core';
import { Block, JsonBlock, BlockHeader, JsonHeader } from '@gxchain2/block';
import { Account, Address } from 'ethereumjs-util';

import * as helper from './helper';

export class Controller {
  node: Node;
  constructor(node: Node) {
    this.node = node;
  }

  //aysnc eth_clientVersion()
  //aysnc eth_sha3()
  //aysnc eth_net_version()
  //aysnc eth_net_listenging()
  //aysnc eth_netpeer_Count()
  //aysnc eth_protocolVersion()
  //aysnc eth_syncing()
  //aysnc eth_coinbase()

  async eth_blockNumber(): Promise<Number> {
    let blockNumber = await Number(this.node.blockchain.latestBlock.header.number);
    return blockNumber;
  }

  async eth_getBlockByNumber([tag, fullTransactions]: [string, boolean]): Promise<JsonBlock> {
    let block!: Block;
    if (tag === 'earliest') {
      block = await this.node.blockchain.getBlock(0);
    } else if (tag === 'latest') {
      block = this.node.blockchain.latestBlock;
    } else if (tag === 'pending') {
      helper.throwRpcErr('Unsupport pending block');
    } else if (Number.isInteger(Number(tag))) {
      block = await this.node.blockchain.getBlock(Number(tag));
    } else {
      helper.throwRpcErr('Invalid tag value');
    }
    return block.toJSON();
  }

  async eth_getBlockHeaderByNumber([tag, fullTransactions]: [string, boolean]): Promise<JsonHeader> {
    let blockHeader!: BlockHeader;
    if (tag === 'earliest') {
      blockHeader = (await this.node.blockchain.getBlock(0)).header;
    } else if (tag === 'latest') {
      blockHeader = this.node.blockchain.latestBlock.header;
    } else if (tag === 'pending') {
      helper.throwRpcErr('Unsupport pending block');
    } else if (Number.isInteger(Number(tag))) {
      blockHeader = (await this.node.blockchain.getBlock(Number(tag))).header;
    } else {
      helper.throwRpcErr('Invalid tag value');
    }
    return blockHeader.toJSON();
  }

  async eth_getAccount([address]: [string]): Promise<any> {
    let account = await this.node.stateManager.getAccount(Address.fromString(address));
    return {
      nonce: account.nonce,
      balance: account.balance,
      stateRoot: account.stateRoot,
      codeHash: account.codeHash
    };
  }

  async eth_getBalance([address]: [string]): Promise<any> {
    let account = await this.node.stateManager.getAccount(Address.fromString(address));
    return {
      balance: account.balance
    };
  }
}
