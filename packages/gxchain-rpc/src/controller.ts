import { Node } from '@gxchain2/core';
import { Block, WrappedBlock } from '@gxchain2/block';
import { Address, bnToHex, bufferToHex, keccakFromHexString, toBuffer, BN } from 'ethereumjs-util';
import { Transaction, WrappedTransaction } from '@gxchain2/tx';

import * as helper from './helper';
import { hexStringToBuffer, hexStringToBN } from '@gxchain2/utils';

type CallData = {
  from?: string;
  to?: string;
  gas?: string;
  gasPrice?: string;
  value?: string;
  data?: string;
  nonce?: string | BN;
};

export class Controller {
  node: Node;
  constructor(node: Node) {
    this.node = node;
  }

  private async nullable() {}

  private async getBlockByTag(tag: string): Promise<Block> {
    let block!: Block;
    if (tag === 'earliest') {
      block = await this.node.blockchain.getBlock(0);
    } else if (tag === 'latest' || tag === undefined) {
      block = this.node.blockchain.latestBlock;
    } else if (tag === 'pending') {
      block = await this.node.miner.worker.getPendingBlock();
    } else if (Number.isInteger(Number(tag))) {
      block = await this.node.blockchain.getBlock(Number(tag));
    } else {
      helper.throwRpcErr('Invalid tag value');
    }
    return block;
  }

  private async getWrappedBlockByTag(tag: string) {
    return new WrappedBlock(await this.getBlockByTag(tag), tag === 'pending');
  }

  private async getStateManagerByTag(tag: string) {
    return this.node.getStateManager((await this.getBlockByTag(tag)).header.stateRoot);
  }

  private async runCall(data: CallData, tag: string) {
    try {
      const block = await this.getBlockByTag(tag);
      const wvm = await this.node.getWrappedVM(block.header.stateRoot);
      return await wvm.vm.runCall({
        block,
        gasPrice: data.gasPrice ? hexStringToBN(data.gasPrice) : undefined,
        origin: data.from ? Address.fromString(data.from) : Address.zero(),
        caller: data.from ? Address.fromString(data.from) : Address.zero(),
        gasLimit: data.gas ? hexStringToBN(data.gas) : undefined,
        to: data.to ? Address.fromString(data.to) : undefined,
        value: data.value ? hexStringToBN(data.value) : undefined,
        data: data.data ? hexStringToBuffer(data.data) : undefined
      });
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  async web3_clientVersion() {
    return 'Mist/v0.0.1/darwin/node12.19.0/typescript4.1.5';
  }
  async web_sha3([data]: [string]): Promise<string> {
    return await bufferToHex(keccakFromHexString(data));
  }

  async net_version() {
    return '77';
  }
  async net_listenging() {
    return true;
  }
  async net_peerCount() {
    return bufferToHex(toBuffer(this.node.peerpool.peers.length));
  }

  async eth_protocolVersion() {
    return '1';
  }
  async eth_syncing() {
    if (!this.node.sync.isSyncing) {
      return false;
    }
    const status = this.node.sync.syncStatus;
    return {
      startingBlock: bufferToHex(toBuffer(status.startingBlock)),
      currentBlock: bufferToHex(this.node.blockchain.latestBlock.header.number.toBuffer()),
      highestBlock: bufferToHex(toBuffer(status.highestBlock))
    };
  }
  async eth_chainId() {
    return bufferToHex(toBuffer(this.node.common.chainId()));
  }
  async eth_coinbase() {
    return !this.node.miner.coinbase ? '0x0000000000000000000000000000000000000000' : bufferToHex(this.node.miner.coinbase);
  }
  async eth_mining() {
    return this.node.miner.isMining;
  }
  async eth_hashrate() {
    return bufferToHex(toBuffer(0));
  }
  async eth_gasPrice() {
    return bufferToHex(toBuffer(1));
  }
  async eth_accounts() {
    return [];
  }
  async eth_blockNumber() {
    return bnToHex(this.node.blockchain.latestBlock.header.number);
  }
  async eth_getBalance([address, tag]: [string, string]) {
    const stateManager = await this.getStateManagerByTag(tag);
    const account = await stateManager.getAccount(Address.fromString(address));
    return bnToHex(account.balance);
  }
  async eth_getStorageAt([address, key, tag]: [string, string, string]) {
    const stateManager = await this.getStateManagerByTag(tag);
    return bufferToHex(await stateManager.getContractStorage(Address.fromString(address), hexStringToBuffer(key)));
  }
  async eth_getTransactionCount([address, tag]: [string, string]) {
    const stateManager = await this.getStateManagerByTag(tag);
    const account = await stateManager.getAccount(Address.fromString(address));
    return bnToHex(account.nonce);
  }
  async eth_getBlockTransactionCountByHash([hash]: [string]) {
    try {
      const number = (await this.node.db.getBlock(hexStringToBuffer(hash))).transactions.length;
      return bufferToHex(toBuffer(number));
    } catch (err) {
      return null;
    }
  }
  async eth_getBlockTransactionCountByNumber([tag]: [string]) {
    try {
      const number = (await this.getBlockByTag(tag)).transactions.length;
      return bufferToHex(toBuffer(number));
    } catch (err) {
      return null;
    }
  }
  async eth_getUncleCountByBlockHash([hash]: [string]) {
    return bufferToHex(toBuffer(0));
  }
  async eth_getUncleCountByBlockNumber([tag]: [string]) {
    return bufferToHex(toBuffer(0));
  }
  async eth_getCode([address, tag]: [string, string]) {
    const stateManager = await this.getStateManagerByTag(tag);
    const code = await stateManager.getContractCode(Address.fromString(address));
    return bufferToHex(code);
  }
  async eth_sign([address, data]: [string, string]) {
    return '0x00';
  }
  async eth_signTransaction([data]: [CallData]) {
    /*
    if (!data.nonce) {
      const stateManager = await this.getStateManagerByTag('latest');
      const account = await stateManager.getAccount(Address.fromString(data.from));
      data.nonce = account.nonce;
    }
    const unsignedTx = Transaction.fromTxData({
      ...data
    }, { common: this.node.common });
    unsignedTx.sign(privateKey);
    */
    return '0x00';
  }
  async eth_sendTransaction([data]: [CallData]) {
    return '0x00';
  }
  async eth_sendRawTransaction([rawtx]: [string]) {
    const tx = Transaction.fromRlpSerializedTx(hexStringToBuffer(rawtx), { common: this.node.common });
    const results = await this.node.addPendingTxs([tx]);
    return results && results.length > 0 && results[0] ? bufferToHex(tx.hash()) : null;
  }
  async eth_call([data, tag]: [CallData, string]) {
    const result = await this.runCall(data, tag);
    return bufferToHex(result.execResult.returnValue);
  }
  async eth_estimateGas([data, tag]: [CallData, string]) {
    const result = await this.runCall(data, tag);
    return bnToHex(result.gasUsed);
  }
  async eth_getBlockByHash([hash, fullTransactions]: [string, boolean]) {
    try {
      return new WrappedBlock(await this.node.db.getBlock(hexStringToBuffer(hash))).toRPCJSON(fullTransactions);
    } catch (err) {
      return null;
    }
  }
  async eth_getBlockByNumber([tag, fullTransactions]: [string, boolean]) {
    try {
      return (await this.getWrappedBlockByTag(tag)).toRPCJSON(fullTransactions);
    } catch (err) {
      return null;
    }
  }
  async eth_getTransactionByHash([hash]: [string]) {
    try {
      return new WrappedTransaction(await this.node.db.getTransaction(hexStringToBuffer(hash))).toRPCJSON();
    } catch (err) {
      return null;
    }
  }
  async eth_getTransactionByBlockHashAndIndex([hash, index]: [string, string]) {
    try {
      return new WrappedTransaction((await this.node.db.getBlock(hexStringToBuffer(hash))).transactions[Number(index)]).toRPCJSON();
    } catch (err) {
      return null;
    }
  }
  async eth_getTransactionByBlockNumberAndIndex([tag, index]: [string, string]) {
    try {
      return new WrappedTransaction((await this.getBlockByTag(tag)).transactions[Number(index)]).toRPCJSON();
    } catch (err) {
      return null;
    }
  }
  async eth_getTransactionReceipt([hash]: [string]) {
    try {
      return (await this.node.db.getReceipt(hexStringToBuffer(hash))).toRPCJSON();
    } catch (err) {
      return null;
    }
  }
  async eth_getUncleByBlockHashAndIndex() {
    return null;
  }
  async eth_getUncleByBlockNumberAndIndex() {
    return null;
  }
  async eth_getCompilers() {
    return [];
  }
  async eth_compileSolidity() {
    helper.throwRpcErr('Unsupported compiler!');
  }
  async eth_compileLLL() {
    helper.throwRpcErr('Unsupported compiler!');
  }
  async eth_compileSerpent() {
    helper.throwRpcErr('Unsupported compiler!');
  }
  //eth_newFilter
  //eth_newBlockFilter
  //eth_newPendingTransactionFilter
  //eth_uninstallFilter
  //eth_getFilterChanges
  //eth_getFilterLogs
  //eth_getLogs
  async eth_getWork() {
    helper.throwRpcErr('Unsupported eth_getWork!');
  }
  async eth_submitWork() {
    helper.throwRpcErr('Unsupported eth_submitWork!');
  }
  async eth_submitHashrate() {
    helper.throwRpcErr('Unsupported eth_submitHashrate!');
  }

  //db_putString
  //db_getString
  //db_putHex
  //db_getHex

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
}
