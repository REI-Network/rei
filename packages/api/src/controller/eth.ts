import { Address, intToHex, bnToHex, bufferToHex, hashPersonalMessage, toRpcSig, ecsign, BN, setLengthLeft } from 'ethereumjs-util';
import { ec as EC } from 'elliptic';
import { hexStringToBN, hexStringToBuffer } from '@rei-network/utils';
import { Block, Log, Transaction, TransactionFactory } from '@rei-network/structure';
import { Common } from '@rei-network/common';
import { CallData, Client, TopicsData } from '../types';
import { Controller } from './base';
import { OutOfGasError } from './errors';

function parseAddressesAndTopics(_addresses?: string | string[], _topics?: TopicsData) {
  const addresses: Address[] = typeof _addresses === 'string' ? [Address.fromString(_addresses)] : _addresses?.map((addr) => Address.fromString(addr)) ?? [];
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
              throw new Error('Invalid topic type');
            }
            return hexStringToBuffer(subTopic);
          });
        } else {
          throw new Error('Invalid topic type');
        }
      })
    : [];
  return { addresses, topics };
}

/**
 * Eth api Controller
 */
export class ETHController extends Controller {
  protocolVersion() {
    return '1';
  }

  /**
   *  Returns an object with data about the sync status or false.
   * @returns The syncing status.
   */
  syncing() {
    if (!this.node.sync.isSyncing) {
      return false;
    }
    const status = this.node.sync.status;
    return {
      startingBlock: intToHex(status.startingBlock),
      currentBlock: bnToHex(this.node.getLatestBlock().header.number),
      highestBlock: intToHex(status.highestBlock)
    };
  }

  /**
   *  Return the current network id
   * @returns The current network id
   */
  chainId() {
    return bnToHex(this.node.getCommon(0).chainIdBN());
  }

  /**
   * Returns the client coinbase address.
   * @returns The coinbase address
   */
  coinbase() {
    return this.node.reimint.coinbase.toString();
  }

  /**
   * Returns true if client is actively mining new blocks
   * @returns True if the node is currently mining, otherwise false
   */
  mining() {
    return true;
  }

  /**
   * Returns the number of hashes per second that the node is mining with
   * @returns The node's hashrate
   */
  hashrate() {
    return intToHex(0);
  }

  /**
   *  Returns the current price per gas in wei
   * @returns Gas price
   */
  gasPrice() {
    return bnToHex(this.oracle.gasPrice);
  }

  /**
   * Returns a list of addresses owned by client
   * @returns Accounts list
   */
  accounts() {
    return this.node.accMngr.totalUnlockedAccounts().map((addr) => bufferToHex(addr));
  }

  /**
   * Returns the number of most recent block
   * @returns Latest block number
   */
  blockNumber() {
    return bnToHex(this.node.getLatestBlock().header.number);
  }

  /**
   * Returns the balance of the account of given address
   * @param address - query address
   * @param tag - block tag
   * @returns Balance of the account
   */
  async getBalance([address, tag]: [string, any]) {
    const stateManager = await this.getStateManagerByTag(tag);
    const account = await stateManager.getAccount(Address.fromString(address));
    return bnToHex(account.balance);
  }

  /**
   * Returns the value from a storage position at a given address
   * @param address - query address
   * @param key  - query key
   * @param tag  - block tag
   */
  async getStorageAt([address, key, tag]: [string, string, any]) {
    const stateManager = await this.getStateManagerByTag(tag);
    return bufferToHex(await stateManager.getContractStorage(Address.fromString(address), setLengthLeft(hexStringToBuffer(key), 32)));
  }

  /**
   * Returns the number of transactions sent from an address
   * @param address - query address
   * @param tag - block tag
   * @returns Nonce of the account
   */
  async getTransactionCount([address, tag]: [string, any]) {
    const stateManager = await this.getStateManagerByTag(tag);
    const account = await stateManager.getAccount(Address.fromString(address));
    return bnToHex(account.nonce);
  }

  /**
   * Returns the number of transactions in a block from a block matching the given block hash.
   * @param hash - query hash
   * @returns Transaction count
   */
  async getBlockTransactionCountByHash([hash]: [string]) {
    try {
      const number = (await this.node.db.getBlock(hexStringToBuffer(hash))).transactions.length;
      return intToHex(number);
    } catch (err) {
      return null;
    }
  }

  /**
   * Returns the number of transactions in a block matching the given block number
   * @param tag - query tag
   * @returns Transaction count
   */
  async getBlockTransactionCountByNumber([tag]: [any]) {
    try {
      const number = (await this.getBlockByTag(tag)).transactions.length;
      return intToHex(number);
    } catch (err) {
      return null;
    }
  }

  /**
   * Returns the number of uncles in a block from a block matching the given block hash
   * @param hash - query hash
   * @returns Uncle block count
   */
  getUncleCountByBlockHash([hash]: [string]) {
    return intToHex(0);
  }

  /**
   * Returns the number of uncles in a block from a block matching the given block number
   * @param tag - query tag
   * @returns Uncle block count
   */
  getUncleCountByBlockNumber([tag]: [any]) {
    return intToHex(0);
  }

  /**
   * Returns code at a given address
   * @param address - query address
   * @param tag - block tag
   * @returns Contract code
   */
  async getCode([address, tag]: [string, any]) {
    const stateManager = await this.getStateManagerByTag(tag);
    const code = await stateManager.getContractCode(Address.fromString(address));
    return bufferToHex(code);
  }

  /**
   * Sign a message with an account
   * @param address - sign address
   * @param data - message data
   * @returns Signature
   */
  sign([address, data]: [string, string]) {
    const signature = ecsign(hashPersonalMessage(Buffer.from(data)), this.node.accMngr.getPrivateKey(address));
    return toRpcSig(signature.v, signature.r, signature.s);
  }

  private async makeTxForUnlockedAccount(data: CallData) {
    if (!data.from) {
      throw new Error('Missing from');
    }
    if (!data.nonce) {
      const stateManager = await this.getStateManagerByTag('latest');
      const account = await stateManager.getAccount(Address.fromString(data.from));
      data.nonce = bnToHex(account.nonce);
    }
    const unsignedTx = TransactionFactory.fromTxData(
      {
        ...data,
        gasLimit: data.gas
      },
      { common: this.node.getLatestCommon() }
    );
    const privateKey = this.node.accMngr.getPrivateKey(data.from);
    return unsignedTx.sign(privateKey);
  }

  /**
   * Signs a transaction that can be submitted to the network at a later time
   * @param data - transaction data
   * @returns Signed transaction
   */
  async signTransaction([data]: [CallData]) {
    const tx = await this.makeTxForUnlockedAccount(data);
    if (!(tx instanceof Transaction)) {
      return null;
    }
    return bufferToHex(tx.serialize());
  }

  /**
   * Creates new message call transaction or a contract creation, if the data field contains code
   * @param data - transaction data
   * @returns Transaction hash
   */
  async sendTransaction([data]: [CallData]) {
    const tx = await this.makeTxForUnlockedAccount(data);
    if (!(tx instanceof Transaction)) {
      return null;
    }

    if (!this.checkPublicKeyOnCurve(tx.getSenderPublicKey())) {
      return null;
    }

    const results = await this.node.addPendingTxs([tx]);
    return results.length > 0 && results[0] ? bufferToHex(tx.hash()) : null;
  }

  /**
   * Creates new message call transaction or a contract creation for signed transactions
   * @param rawtx - raw transaction
   * @returns Transaction hash
   */
  async sendRawTransaction([rawtx]: [string]) {
    const tx = TransactionFactory.fromSerializedData(hexStringToBuffer(rawtx), { common: this.node.getLatestCommon() });
    if (!(tx instanceof Transaction)) {
      return null;
    }

    if (!this.checkPublicKeyOnCurve(tx.getSenderPublicKey())) {
      return null;
    }

    const results = await this.node.addPendingTxs([tx]);
    return results.length > 0 && results[0] ? bufferToHex(tx.hash()) : null;
  }

  /**
   * Executes a new message call immediately without creating a transaction on the block chain.
   * @param data - transaction data
   * @param tag - block tag
   * @returns
   */
  async call([data, tag]: [CallData, any]) {
    const result = await this.runCall(data, tag);
    return bufferToHex(result.execResult.returnValue);
  }

  private calculateBaseFee(data: CallData, common: Common) {
    const txDataZero = common.param('gasPrices', 'txDataZero');
    const txDataNonZero = common.param('gasPrices', 'txDataNonZero');
    let cost = 0;
    if (data.data) {
      const buf = hexStringToBuffer(data.data);
      for (let i = 0; i < buf.length; i++) {
        buf[i] === 0 ? (cost += txDataZero) : (cost += txDataNonZero);
      }
    }

    const fee = new BN(cost).addn(common.param('gasPrices', 'tx'));
    if (common.gteHardfork('homestead') && (!data.to || hexStringToBuffer(data.to).length === 0)) {
      fee.iaddn(common.param('gasPrices', 'txCreation'));
    }
    return fee;
  }

  /**
   * Generates and returns an estimate of how much gas is necessary to allow the transaction to complete
   * @param data - transaction data
   * @param tag - block tag
   * @returns Estimated gas limit
   */
  async estimateGas([data, tag]: [CallData, any]) {
    const block = await this.getBlockByTag(tag);
    const baseFee = this.calculateBaseFee(data, block._common);
    const gas = data.gas ? hexStringToBN(data.gas) : block.header.gasLimit;
    if (gas.lt(baseFee)) {
      throw new OutOfGasError(gas);
    }

    let lo = new BN(-1);
    let hi = gas.sub(baseFee);
    if (hi.lte(lo)) {
      throw new Error('invalid gas limit');
    }
    const cap = hi;

    const executable = async (gas: BN) => {
      try {
        await this.runCall({ ...data, gas: bnToHex(gas) }, block);
      } catch (err: any) {
        return err;
      }
    };

    while (lo.addn(1).lt(hi)) {
      const mid = lo.add(hi).divn(2);
      if (await executable(mid)) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    if (hi.eq(cap)) {
      const err = await executable(hi);
      if (err) {
        if (err instanceof OutOfGasError) {
          err.gas.iadd(baseFee);
        }
        throw err;
      }
    }

    return bnToHex(hi.add(baseFee));
  }

  /**
   * Returns information about a block by hash
   * @param hash - block hash
   * @param fullTransactions - include full transactions or not
   * @returns Block data
   */
  async getBlockByHash([hash, fullTransactions]: [string, boolean]) {
    try {
      return ((await this.node.db.getBlock(hexStringToBuffer(hash))) as Block).toRPCJSON(false, fullTransactions);
    } catch (err) {
      return null;
    }
  }

  /**
   * Returns information about a block by number.
   * @param tag - block tag
   * @param fullTransactions - include full transactions or not
   * @returns Block data
   */
  async getBlockByNumber([tag, fullTransactions]: [any, boolean]) {
    try {
      return (await this.getBlockByTag(tag)).toRPCJSON(tag === 'pending', fullTransactions);
    } catch (err) {
      return null;
    }
  }

  /**
   * Returns the information about a transaction requested by transaction hash
   * @param hash - transaction hash
   * @returns Transaction data
   */
  async getTransactionByHash([hash]: [string]) {
    const hashBuffer = hexStringToBuffer(hash);
    try {
      return ((await this.node.db.getTransaction(hashBuffer)) as Transaction).toRPCJSON();
    } catch (err: any) {
      if (err.type !== 'NotFoundError') {
        throw err;
      }
    }
    const tx = this.node.txPool.getTransaction(hashBuffer);
    if (!tx) {
      return null;
    }
    return tx.toRPCJSON();
  }

  /**
   * Returns information about a transaction by block hash and transaction index position
   * @param hash - block hash
   * @param index - transaction index
   * @returns Transaction data
   */
  async getTransactionByBlockHashAndIndex([hash, index]: [string, string]) {
    try {
      const block = await this.node.db.getBlock(hexStringToBuffer(hash));
      const tx = block.transactions[Number(index)] as Transaction;
      tx.initExtension(block);
      return tx.toRPCJSON();
    } catch (err) {
      return null;
    }
  }

  /**
   * Returns information about a transaction by block number and transaction index position
   * @param tag - block tag
   * @param index - transaction index
   * @returns Transaction data
   */
  async getTransactionByBlockNumberAndIndex([tag, index]: [any, string]) {
    try {
      const block = await this.getBlockByTag(tag);
      const tx = block.transactions[Number(index)] as Transaction;
      tx.initExtension(block);
      return tx.toRPCJSON();
    } catch (err) {
      return null;
    }
  }

  /**
   * Returns the receipt of a transaction by transaction hash
   * @param hash - transaction hash
   * @returns Transaction receipt
   */
  async getTransactionReceipt([hash]: [string]) {
    try {
      return (await this.node.db.getReceipt(hexStringToBuffer(hash))).toRPCJSON();
    } catch (err) {
      return null;
    }
  }

  /**
   * Returns information about a uncle of a block by hash and uncle index position
   * @returns Uncle block data
   */
  getUncleByBlockHashAndIndex() {
    return null;
  }

  /**
   * Returns information about a uncle of a block by number and uncle index position
   * @returns Uncle block data
   */
  getUncleByBlockNumberAndIndex() {
    return null;
  }

  /**
   * Returns a list of available compilers in the client
   * @returns Compilers
   */
  getCompilers() {
    return [];
  }

  /**
   * Returns compiled solidity code
   */
  compileSolidity() {
    throw new Error('Unsupported compiler!');
  }

  /**
   * Returns compiled LLL code
   */
  compileLLL() {
    throw new Error('Unsupported compiler!');
  }

  /**
   * Returns compiled serpent code
   */
  compileSerpent() {
    throw new Error('Unsupported compiler!');
  }

  /**
   * Creates a filter object, based on filter options, to notify when the state changes (logs)
   * @param param0 - filter parameters
   * @returns Filter id
   */
  async newFilter([{ fromBlock, toBlock, address: _addresses, topics: _topics }]: [{ fromBlock?: string; toBlock?: string; address?: string | string[]; topics?: TopicsData; blockhash?: string }]) {
    const from = await this.getBlockNumberByTag(fromBlock ? fromBlock : 'latest');
    const to = await this.getBlockNumberByTag(toBlock ? toBlock : 'latest');
    const { addresses, topics } = parseAddressesAndTopics(_addresses, _topics);
    return this.filterSystem.newFilter('logs', { fromBlock: from, toBlock: to, addresses, topics });
  }

  /**
   * Creates a filter in the node, to notify when a new block arrives
   * @returns Filter id
   */
  newBlockFilter() {
    return this.filterSystem.newFilter('newHeads');
  }

  /**
   * Creates a filter in the node, to notify when new pending transactions arrive
   * @returns Filter id
   */
  newPendingTransactionFilter() {
    return this.filterSystem.newFilter('newPendingTransactions');
  }

  /**
   * Uninstalls a filter with given id
   * @param id - filter id
   * @returns `true` if sucessfully deleted
   */
  uninstallFilter([id]: [string]) {
    return this.filterSystem.uninstall(id);
  }

  /**
   * Polling method for a filter, which returns an array of logs which occurred since last poll
   * @param id - filter id
   * @returns Filter changes
   */
  getFilterChanges([id]: [string]) {
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

  /**
   * Returns an array of all logs matching filter with given id
   * @param id - filter id
   * @returns Filter logs
   */
  async getFilterLogs([id]: [string]) {
    const query = this.filterSystem.getFilterQuery(id);
    if (!query) {
      return [];
    }
    const { fromBlock, toBlock, addresses, topics } = query;
    const from = await this.getBlockNumberByTag(fromBlock ?? 'latest');
    const to = await this.getBlockNumberByTag(toBlock ?? 'latest');
    if (to.sub(from).gtn(5000)) {
      throw new Error('getFilterLogs, too many block, max limit is 5000');
    }

    const filter = this.node.getFilter();
    const logs = await filter.filterRange(from, to, addresses, topics);
    return logs.map((log) => log.toRPCJSON());
  }

  /**
   * Returns an array of all logs matching a given filter object
   * @param param0 - filter parameters
   * @returns Logs
   */
  async getLogs([{ fromBlock, toBlock, address: _addresses, topics: _topics, blockhash }]: [{ fromBlock?: string; toBlock?: string; address?: string | string[]; topics?: TopicsData; blockhash?: string }]) {
    const from = await this.getBlockNumberByTag(fromBlock ?? 'latest');
    const to = await this.getBlockNumberByTag(toBlock ?? 'latest');
    if (to.sub(from).gtn(5000)) {
      throw new Error('getLogs, too many block, max limit is 5000');
    }

    const { addresses, topics } = parseAddressesAndTopics(_addresses, _topics);
    const filter = this.node.getFilter();
    const logs = blockhash ? await filter.filterBlock(hexStringToBuffer(blockhash), addresses, topics) : await filter.filterRange(from, to, addresses, topics);
    return logs.map((log) => log.toRPCJSON());
  }

  /**
   * Returns the hash of the current block, the seedHash, and the boundary condition to be met ("target").
   */
  getWork() {
    throw new Error('Unsupported getWork!');
  }

  /**
   * Used for submitting a proof-of-work solution.
   */
  submitWork() {
    throw new Error('Unsupported submitWork!');
  }

  /**
   * Used for submitting mining hashrate.
   */
  submitHashrate() {
    throw new Error('Unsupported submitHashrate!');
  }

  /**
   * Cancels an existing subscription so that no further events are sent.
   * @param id - subscription id
   * @returns `true` if subscription was successfully canceled
   */
  unsubscribe([id]: [string]) {
    return this.filterSystem.unsubscribe(id);
  }

  /**
   * Creates a new subscription for specified events
   * @param type  - subscription type
   * @param options - subscription options
   * @param client - subscription client
   * @returns Subscription id
   */
  async subscribe([type, options]: [string, undefined | { address?: string | string[]; topics?: TopicsData }], client?: Client) {
    if (!client) {
      throw new Error('subscribe is only supported on websocket!');
    }

    if (type !== 'newHeads' && type !== 'logs' && type !== 'newPendingTransactions' && type !== 'syncing') {
      throw new Error('subscribe, invalid subscription type!');
    }

    if (type === 'logs') {
      return this.filterSystem.subscribe(client, type, parseAddressesAndTopics(options?.address, options?.topics));
    } else {
      return this.filterSystem.subscribe(client, type);
    }
  }

  /**
   * Checks if the public key is on the secp256k1 curve
   * @param publicKey  - public key
   * @returns `true` if the public key is on the curve
   */
  private async checkPublicKeyOnCurve(publicKey: Buffer) {
    const publicKeyHex = publicKey.toString('hex');
    const ec = new EC('secp256k1');
    const key = ec.keyFromPublic('04' + publicKeyHex, 'hex'); //Add "04" to form the complete uncompressed public key
    return ec.curve.validate(key.getPublic());
  }
}
