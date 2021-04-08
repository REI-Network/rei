import { Address, bnToHex, bufferToHex, keccakFromHexString, toBuffer, BN } from 'ethereumjs-util';
import { Node } from '@gxchain2/core';
import { Block, WrappedBlock } from '@gxchain2/block';
import { Transaction, WrappedTransaction } from '@gxchain2/tx';
import { hexStringToBuffer, hexStringToBN, logger } from '@gxchain2/utils';
import { Log } from '@gxchain2/receipt';
import * as helper from './helper';
import { FilterSystem } from './filtersystem';
import { RpcContext } from './index';

type CallData = {
  from?: string;
  to?: string;
  gas?: string;
  gasPrice?: string;
  value?: string;
  data?: string;
  nonce?: string | BN;
};

type TopicsData = (string | null | (string | null)[])[];

function parseAddressesAndTopics(_addresses?: string[], _topics?: TopicsData) {
  const addresses: Address[] = _addresses ? _addresses.map((addr) => Address.fromString(addr)) : [];
  const topics: (Buffer | null | (Buffer | null)[])[] = _topics
    ? _topics.map((topic) => {
        if (topic === null) {
          return null;
        } else if (typeof topic === 'string') {
          return hexStringToBuffer(topic);
        } else if (Array.isArray(topic)) {
          return topic.map((subTopic) => {
            if (subTopic === null) {
              return null;
            }
            if (typeof subTopic !== 'string') {
              helper.throwRpcErr('Invalid topic type');
            }
            return hexStringToBuffer(subTopic);
          });
        } else {
          helper.throwRpcErr('Invalid topic type');
          // for types.
          return null;
        }
      })
    : [];
  return { addresses, topics };
}

export class Controller {
  private readonly node: Node;
  private readonly filterSystem: FilterSystem;
  constructor(node: Node, filterSystem: FilterSystem) {
    this.node = node;
    this.filterSystem = filterSystem;
  }

  private async getBlockNumberByTag(tag: string): Promise<BN> {
    if (tag === 'earliest') {
      return new BN(0);
    } else if (tag === 'latest' || tag === undefined) {
      return this.node.blockchain.latestBlock.header.number.clone();
    } else if (tag === 'pending') {
      return this.node.blockchain.latestBlock.header.number.addn(1);
    } else if (Number.isInteger(Number(tag))) {
      return new BN(tag);
    } else {
      helper.throwRpcErr('Invalid tag value');
      // for types.
      return new BN(0);
    }
  }

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
    return tag === 'pending' ? await this.node.miner.worker.getPendingStateManager() : this.node.getStateManager((await this.getBlockByTag(tag)).header.stateRoot);
  }

  private calculateBaseFee(data: CallData) {
    const txDataZero = this.node.common.param('gasPrices', 'txDataZero');
    const txDataNonZero = this.node.common.param('gasPrices', 'txDataNonZero');
    let cost = 0;
    if (data.data) {
      const buf = hexStringToBuffer(data.data);
      for (let i = 0; i < data.data.length; i++) {
        buf[i] === 0 ? (cost += txDataZero) : (cost += txDataNonZero);
      }
    }
    const fee = new BN(cost).addn(this.node.common.param('gasPrices', 'tx'));
    if (this.node.common.gteHardfork('homestead') && (data.to === undefined || hexStringToBuffer(data.to).length === 0)) {
      fee.iaddn(this.node.common.param('gasPrices', 'txCreation'));
    }
    return fee;
  }

  private async runCall(data: CallData, tag: string) {
    const block = await this.getBlockByTag(tag);
    const wvm = await this.node.getWrappedVM(block.header.stateRoot);
    await wvm.vm.stateManager.checkpoint();
    try {
      const result = await wvm.vm.runCall({
        block,
        gasPrice: data.gasPrice ? hexStringToBN(data.gasPrice) : undefined,
        origin: data.from ? Address.fromString(data.from) : Address.zero(),
        caller: data.from ? Address.fromString(data.from) : Address.zero(),
        gasLimit: data.gas ? hexStringToBN(data.gas) : undefined,
        to: data.to ? Address.fromString(data.to) : undefined,
        value: data.value ? hexStringToBN(data.value) : undefined,
        data: data.data ? hexStringToBuffer(data.data) : undefined
      });
      await wvm.vm.stateManager.revert();
      result.gasUsed.iadd(this.calculateBaseFee(data));
      return result;
    } catch (err) {
      await wvm.vm.stateManager.revert();
      logger.error('Controller::runCall, catch error:', err);
      throw err;
    }
  }

  web3_clientVersion() {
    return 'Mist/v0.0.1';
  }
  async web_sha3([data]: [string]): Promise<string> {
    return await bufferToHex(keccakFromHexString(data));
  }

  net_version() {
    return '77';
  }
  net_listenging() {
    return true;
  }
  net_peerCount() {
    return bufferToHex(toBuffer(this.node.peerpool.peers.length));
  }

  eth_protocolVersion() {
    return '1';
  }
  eth_syncing() {
    if (!this.node.sync.isSyncing) {
      return false;
    }
    const status = this.node.sync.syncStatus;
    return {
      startingBlock: bufferToHex(toBuffer(status.startingBlock)),
      currentBlock: bnToHex(this.node.blockchain.latestBlock.header.number),
      highestBlock: bufferToHex(toBuffer(status.highestBlock))
    };
  }
  eth_chainId() {
    return bufferToHex(toBuffer(this.node.common.chainId()));
  }
  eth_coinbase() {
    return !this.node.miner.coinbase ? Address.zero().toString() : bufferToHex(this.node.miner.coinbase);
  }
  eth_mining() {
    return this.node.miner.isMining;
  }
  eth_hashrate() {
    return bufferToHex(toBuffer(0));
  }
  eth_gasPrice() {
    return bufferToHex(toBuffer(1));
  }
  eth_accounts() {
    return [];
  }
  eth_blockNumber() {
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
  eth_getUncleCountByBlockHash([hash]: [string]) {
    return bufferToHex(toBuffer(0));
  }
  eth_getUncleCountByBlockNumber([tag]: [string]) {
    return bufferToHex(toBuffer(0));
  }
  async eth_getCode([address, tag]: [string, string]) {
    const stateManager = await this.getStateManagerByTag(tag);
    const code = await stateManager.getContractCode(Address.fromString(address));
    return bufferToHex(code);
  }
  eth_sign([address, data]: [string, string]) {
    return '0x00';
  }
  eth_signTransaction([data]: [CallData]) {
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
  eth_sendTransaction([data]: [CallData]) {
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
    const hashBuffer = hexStringToBuffer(hash);
    try {
      return (await this.node.db.getWrappedTransaction(hashBuffer)).toRPCJSON();
    } catch (err) {
      if (err.type !== 'NotFoundError') {
        throw err;
      }
    }
    const tx = this.node.txPool.getTransaction(hashBuffer);
    if (!tx) {
      return null;
    }
    return new WrappedTransaction(tx).toRPCJSON();
  }
  async eth_getTransactionByBlockHashAndIndex([hash, index]: [string, string]) {
    try {
      const block = await this.node.db.getBlock(hexStringToBuffer(hash));
      const wtx = new WrappedTransaction(block.transactions[Number(index)]);
      wtx.installProperties(block, Number(index));
      return wtx.toRPCJSON();
    } catch (err) {
      return null;
    }
  }
  async eth_getTransactionByBlockNumberAndIndex([tag, index]: [string, string]) {
    try {
      const block = await this.getBlockByTag(tag);
      const wtx = new WrappedTransaction(block.transactions[Number(index)]);
      wtx.installProperties(block, Number(index));
      return wtx.toRPCJSON();
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
  eth_getUncleByBlockHashAndIndex() {
    return null;
  }
  eth_getUncleByBlockNumberAndIndex() {
    return null;
  }
  eth_getCompilers() {
    return [];
  }
  eth_compileSolidity() {
    helper.throwRpcErr('Unsupported compiler!');
  }
  eth_compileLLL() {
    helper.throwRpcErr('Unsupported compiler!');
  }
  eth_compileSerpent() {
    helper.throwRpcErr('Unsupported compiler!');
  }
  async eth_newFilter([{ fromBlock, toBlock, address: _addresses, topics: _topics }]: [{ fromBlock?: string; toBlock?: string; address?: string[]; topics?: TopicsData; blockhash?: string }]) {
    const from = await this.getBlockNumberByTag(fromBlock ? fromBlock : 'latest');
    const to = await this.getBlockNumberByTag(toBlock ? toBlock : 'latest');
    const { addresses, topics } = parseAddressesAndTopics(_addresses, _topics);
    return this.filterSystem.newFilter('logs', { fromBlock: from, toBlock: to, addresses, topics });
  }
  eth_newBlockFilter() {
    return this.filterSystem.newFilter('newHeads');
  }
  eth_newPendingTransactionFilter() {
    return this.filterSystem.newFilter('newPendingTransactions');
  }
  eth_uninstallFilter([id]: [string]) {
    return this.filterSystem.uninstall(id);
  }
  eth_getFilterChanges([id]: [string]) {
    const changes = this.filterSystem.filterChanges(id);
    if (!changes || changes.length === 0) {
      return [];
    }
    if (changes[0] instanceof Log) {
      return (changes as Log[]).map((log) => log.toRPCJSON());
    } else {
      return (changes as Buffer[]).map((buf) => bufferToHex(buf));
    }
  }
  async eth_getFilterLogs([id]: [string]) {
    const query = this.filterSystem.getFilterQuery(id);
    if (!query) {
      return [];
    }
    let { fromBlock: from, toBlock: to, addresses, topics } = query;
    from = from ? from : await this.getBlockNumberByTag('latest');
    to = to ? to : await this.getBlockNumberByTag('latest');
    const filter = this.node.getFilter();
    const logs = await filter.filterRange(from, to, addresses, topics);
    return logs.map((log) => log.toRPCJSON());
  }
  async eth_getLogs([{ fromBlock, toBlock, address: _addresses, topics: _topics, blockhash }]: [{ fromBlock?: string; toBlock?: string; address?: string[]; topics?: TopicsData; blockhash?: string }]) {
    const from = await this.getBlockNumberByTag(fromBlock ? fromBlock : 'latest');
    const to = await this.getBlockNumberByTag(toBlock ? toBlock : 'latest');
    const { addresses, topics } = parseAddressesAndTopics(_addresses, _topics);
    const filter = this.node.getFilter();
    const logs = blockhash ? await filter.filterBlock(hexStringToBuffer(blockhash), addresses, topics) : await filter.filterRange(from, to, addresses, topics);
    return logs.map((log) => log.toRPCJSON());
  }
  eth_getWork() {
    helper.throwRpcErr('Unsupported eth_getWork!');
  }
  eth_submitWork() {
    helper.throwRpcErr('Unsupported eth_submitWork!');
  }
  eth_submitHashrate() {
    helper.throwRpcErr('Unsupported eth_submitHashrate!');
  }
  eth_unsubscribe([id]: [string]) {
    return this.filterSystem.unsubscribe(id);
  }
  async eth_subscribe([type, options]: [string, undefined | { address?: string[]; topics?: TopicsData }], context: RpcContext) {
    if (!context.client) {
      helper.throwRpcErr('eth_subscribe is only supported on websocket!');
      // for types.
      return;
    }
    if (type !== 'newHeads' && type !== 'logs' && type !== 'newPendingTransactions' && type !== 'syncing') {
      helper.throwRpcErr('eth_subscribe, invalid subscription type!');
      // for types.
      return;
    }
    if (type === 'logs') {
      return this.filterSystem.subscribe(context.client, type, parseAddressesAndTopics(options?.address, options?.topics));
    } else {
      return this.filterSystem.subscribe(context.client, type);
    }
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

  txpool_content() {
    return this.node.txPool.getPoolContent();
  }
}
