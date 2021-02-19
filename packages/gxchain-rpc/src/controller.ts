import { Node } from '@gxchain2/core';
import { Block, JsonBlock, BlockHeader, JsonHeader } from '@gxchain2/block';
import { Account, Address, bufferToHex, keccakFromHexString } from 'ethereumjs-util';
//import { Transaction } from '@gxchain2/tx';

import * as helper from './helper';
import { hexStringToBuffer } from '@gxchain2/utils';

export class Controller {
  node: Node;
  constructor(node: Node) {
    this.node = node;
  }

  private async getBlockByTag(tag: string): Promise<Block> {
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
    return block;
  }

  //web3_clientVersion

  async web_sha3([data]: [string]): Promise<string> {
    return await bufferToHex(keccakFromHexString(data));
  }

  //aysnc eth_net_version()
  //aysnc eth_net_listenging()
  //aysnc eth_netpeer_Count()
  //aysnc eth_protocolVersion()
  //aysnc eth_syncing()
  async eth_coinbase(): Promise<string> {
    return await '0x0000000000000000000000000000000000000000';
  }

  async eth_blockNumber(): Promise<string> {
    let blockNumber = await Number(this.node.blockchain.latestBlock.header.number);
    return '0x' + blockNumber.toString(16);
  }

  async eth_getStorageAt([address, key, tag]: [string, string, string]): Promise<any> {
    /*
    const blockHeader = (await this.getBlockByTag(tag)).header;
    const stateManager = this.node.stateManager.copy();
    await stateManager.setStateRoot(blockHeader.stateRoot);
    return bufferToHex(await stateManager.getContractStorage(Address.fromString(address), hexStringToBuffer(key)));
    */
  }

  async eth_getTransactionCount([address]: [string]): Promise<any> {
    /*
    let nonce = Buffer.from((await this.node.stateManager.getAccount(Address.fromString(address))).nonce);
    return bufferToHex(nonce);
    */
  }

  async eth_getBlockTransactionCountByHash([hash]: [string]): Promise<string> {
    let number = (await this.node.db.getBlock(hexStringToBuffer(hash))).transactions.length;
    return bufferToHex(Buffer.from(number.toString));
  }

  async eth_getBlockTransactionCountByNumber([tag]: [string]): Promise<string> {
    let transactionNumber!: number;
    if (tag === 'earliest') {
      transactionNumber = await (await this.node.blockchain.getBlock(0)).transactions.length;
    } else if (tag === 'latest') {
      transactionNumber = this.node.blockchain.latestBlock.transactions.length;
    } else if (tag === 'pending') {
      helper.throwRpcErr('Unsupport pending block');
    } else if (Number.isInteger(Number(tag))) {
      transactionNumber = (await this.node.blockchain.getBlock(Number(tag))).transactions.length;
    } else {
      helper.throwRpcErr('Invalid tag value');
    }
    return bufferToHex(Buffer.from(transactionNumber.toString));
  }

  async eth_getUncleCountByBlockHash([data]: [string]): Promise<string> {
    return '0x00';
  } //0

  async eth_getUncleCountByBlockNumber([tag]: [string]): Promise<string> {
    return '0x00';
  }

  async eth_getCode([data, tag]: [Address, string]): Promise<any> {
    /*
    return await this.node.vm.stateManager.getContractCode(data);
    */
  }

  //eth_sign
  //eth_signTransaction
  //eth_sendTransaction
  //eth_sendRawTransaction
  //eth_call
  //eth_estimateGas
  async eth_getBlockByHash([hash, fullTransactions]: [string, boolean]): Promise<JsonBlock> {
    return (await this.node.db.getBlock(hexStringToBuffer(hash))).toJSON();
  }

  async eth_getBlockByNumber([tag, fullTransactions]: [string, boolean]): Promise<JsonBlock> {
    const block = await this.getBlockByTag(tag);
    return block.toJSON();
  }

  async eth_getBlockHeaderByNumber([tag, fullTransactions]: [string, boolean]): Promise<JsonHeader> {
    const blockHeader = (await this.getBlockByTag(tag)).header;
    return blockHeader.toJSON();
  }

  /*
  async eth_getTransactionByHash([hash]: [string]): Promise<any> {
    return (await this.node.db.getTransaction(hexStringToBuffer(hash))).toRPCJSON();
  }

  async eth_getTransactionByBlockHashAndIndex([hash, index]: [string, number]): Promise<any> {
    return (await this.node.db.getBlock(hexStringToBuffer(hash))).transactions[index].toRPCJSON();
  }

  async eth_getTransactionByBlockNumberAndIndex([number, index]: [number, number]): Promise<any> {
    return (await this.node.db.getBlock(number)).transactions[index].toRPCJSON();
  }

  async eth_getTransactionReceipt([hash]: [string]): Promise<any> {
    return (await this.node.db.getReceipt(hexStringToBuffer(hash))).toRPCJSON;
  }
  */

  async eth_getUncleByBlockHashAndIndex([data, quantity]: [string, string]): Promise<any> {
    return {};
  }

  async eth_getUncleByBlockNumberAndIndex([tag, quantity]: [string, string]): Promise<any> {
    return {};
  }

  //eth_compileSolidity
  //eth_compileLLL
  //eth_compileSerpent

  //eth_newFilter
  //eth_newBlockFilter
  //eth_newPendingTransactionFilter
  //eth_uninstallFilter
  //eth_getFilterChanges
  //eth_getFilterLogs
  //eth_getLogs

  //shh_version
  //shh_post
  //shh_newIdentity
  //shh_hasIdentity
  //shh_newGroup(?)
  //shh_addToGroup
  //shh_newFilter
  //shh_uninstallFilter
  //shh_getFilterChanges
  //shh_getMessages

  async eth_getAccount([address]: [string]): Promise<any> {
    /*
    let account = await this.node.stateManager.getAccount(Address.fromString(address));
    return {
      nonce: account.nonce,
      balance: account.balance,
      stateRoot: account.stateRoot,
      codeHash: account.codeHash
    };
    */
  }

  async eth_getBalance([address]: [string]): Promise<any> {
    /*
    let account = await this.node.stateManager.getAccount(Address.fromString(address));
    return {
      balance: account.balance
    };
    */
  }
}
