import { Node } from '@gxchain2/core';
import { Block, JsonBlock, BlockHeader, JsonHeader } from '@gxchain2/block';
import { Account, Address } from 'ethereumjs-util';
//import { Transaction } from '@gxchain2/tx';

import * as helper from './helper';
import { promises } from 'dns';

export class Controller {
  node: Node;
  constructor(node: Node) {
    this.node = node;
  }
  hexStringToBuffer = (hex: string): Buffer => {
    return hex.indexOf('0x') === 0 ? Buffer.from(hex.substr(2), 'hex') : Buffer.from(hex, 'hex');
  };
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

  //eth_getStorageAt
  //eth_getTransactionCount
  //eth_getBlockTransactionCountByHash
  //eth_getBlockTransactionCountByNumber
  //eth_getUncleCountByBlockHash
  //eth_getUncleCountByBlockNumber
  //eth_getCode
  //eth_sign
  //eth_signTransaction
  //eth_sendTransaction
  //eth_sendRawTransaction
  //eth_call
  //eth_estimateGas
  async eth_getBlockByHash([hash, fullTransactions]: [string, boolean]): Promise<JsonBlock> {
    return (await this.node.db.getBlock(this.hexStringToBuffer(hash))).toJSON();
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

  async eth_getTransactionByHash([hash]: [string]): Promise<any> {
    return (await this.node.db.getTransaction(this.hexStringToBuffer(hash))).toRPCJSON();
  }

  async eth_getTransactionByBlockHashAndIndex([hash, index]: [string, number]): Promise<any> {
    return (await (await this.node.db.getBlock(this.hexStringToBuffer(hash))).transactions[index]).toRPCJSON;
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
