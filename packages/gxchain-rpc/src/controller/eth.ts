import { Address, bnToHex, bufferToHex, toBuffer, hashPersonalMessage, toRpcSig, ecsign } from 'ethereumjs-util';
import { WrappedBlock } from '@gxchain2/block';
import { TransactionFactory, WrappedTransaction } from '@gxchain2/tx';
import { hexStringToBuffer } from '@gxchain2/utils';
import { Log } from '@gxchain2/receipt';
import * as helper from '../helper';
import { RpcContext } from '../index';
import { Controller, CallData } from './base';

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

export class ETHController extends Controller {
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
    return bufferToHex(this.node.getCommon(0).chainIdBN().toBuffer());
  }
  eth_coinbase() {
    return bufferToHex(this.node.miner.coinbase);
  }
  eth_mining() {
    return this.node.miner.isMining;
  }
  eth_hashrate() {
    return bufferToHex(toBuffer(0));
  }
  // TODO: eth_gasPrice
  eth_gasPrice() {
    return '0x3b9aca00';
  }
  eth_accounts() {
    return this.node.accMngr.totalUnlockedAccounts().map((addr) => bufferToHex(addr));
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
    const signature = ecsign(hashPersonalMessage(Buffer.from(data)), this.node.accMngr.getPrivateKey(address));
    return toRpcSig(signature.v, signature.r, signature.s);
  }
  private async makeTxForUnlockedAccount(data: CallData) {
    if (!data.from) {
      helper.throwRpcErr('Missing from');
      // for types.
      throw new Error();
    }
    if (!data.nonce) {
      const stateManager = await this.getStateManagerByTag('latest');
      const account = await stateManager.getAccount(Address.fromString(data.from));
      data.nonce = account.nonce.toString();
    }
    const unsignedTx = TransactionFactory.fromTxData(
      {
        ...data
      },
      { common: this.node.getCommon(0) }
    );
    const privateKey = this.node.accMngr.getPrivateKey(data.from);
    return unsignedTx.sign(privateKey);
  }
  async eth_signTransaction([data]: [CallData]) {
    return bufferToHex((await this.makeTxForUnlockedAccount(data)).serialize());
  }
  async eth_sendTransaction([data]: [CallData]) {
    const tx = await this.makeTxForUnlockedAccount(data);
    const results = await this.node.addPendingTxs([tx]);
    return results.length > 0 && results[0] ? bufferToHex(tx.hash()) : null;
  }
  async eth_sendRawTransaction([rawtx]: [string]) {
    const tx = TransactionFactory.fromSerializedData(hexStringToBuffer(rawtx), { common: this.node.getCommon(0) });
    const results = await this.node.addPendingTxs([tx]);
    return results.length > 0 && results[0] ? bufferToHex(tx.hash()) : null;
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
}
