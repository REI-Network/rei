import { TopicsData, CallData, ApiServer } from '@rei-network/api';
// import { WebsocketClient } from '../client';

/**
 * Eth api Controller
 */
export class ETHController {
  readonly apiServer: ApiServer;

  constructor(apiServer: ApiServer) {
    this.apiServer = apiServer;
  }

  /**
   * Returns the current protocol version.
   * @returns The current client version
   */
  protocolVersion() {
    return this.apiServer.protocolVersion();
  }

  /**
   * Returns an object with data about the sync status or false
   * @returns The syncing status.
   */
  syncing() {
    return this.apiServer.syncing();
  }

  /**
   * Return the current network id
   * @returns The current network id
   */
  chainId() {
    return this.apiServer.chainId();
  }

  coinbase() {
    return this.apiServer.coinbase();
  }

  /**
   * Returns true if client is actively mining new blocks
   * @returns True if the node is currently mining, otherwise false
   */
  mining() {
    return this.apiServer.mining();
  }

  /**
   * Returns the number of hashes per second that the node is mining with
   * @returns The node's hashrate
   */
  hashrate() {
    return this.apiServer.hashrate();
  }

  /**
   * Returns the current price per gas in wei
   * @returns Gas price
   */
  gasPrice() {
    return this.apiServer.gasPrice();
  }

  /**
   * Returns a list of addresses owned by client
   * @returns Accounts list
   */
  accounts() {
    return this.apiServer.accounts();
  }

  /**
   * Returns the number of most recent block
   * @returns Latest block number
   */
  blockNumber() {
    return this.apiServer.blockNumber();
  }

  /**
   * Returns the balance of the account of given address
   * @param address - query address
   * @param tag - block tag
   * @returns Balance of the account
   */
  async getBalance([address, tag]: [string, any]) {
    return this.apiServer.getBalance(address, tag);
  }

  /**
   * Returns the value from a storage position at a given address
   * @param address - query address
   * @param key  - query key
   * @param tag  - block tag
   */
  async getStorageAt([address, key, tag]: [string, string, any]) {
    return this.apiServer.getStorageAt(address, key, tag);
  }

  /**
   * Returns the number of transactions sent from an address
   * @param address - query address
   * @param tag - block tag
   * @returns Nonce of the account
   */
  async getTransactionCount([address, tag]: [string, any]) {
    return this.apiServer.getTransactionCount(address, tag);
  }

  /**
   * Returns the number of transactions in a block from a block matching the given block hash.
   * @param hash - query hash
   * @returns Transaction count
   */
  async getBlockTransactionCountByHash([hash]: [string]) {
    return this.apiServer.getBlockTransactionCountByHash(hash);
  }

  /**
   * Returns the number of transactions in a block matching the given block number
   * @param tag - query tag
   * @returns Transaction count
   */
  async getBlockTransactionCountByNumber([tag]: [any]) {
    return this.apiServer.getBlockTransactionCountByNumber(tag);
  }

  /**
   * Returns the number of uncles in a block from a block matching the given block hash
   * @param hash - query hash
   * @returns Uncle block count
   */
  getUncleCountByBlockHash([hash]: [string]) {
    return this.apiServer.getUncleCountByBlockHash(hash);
  }

  /**
   * Returns the number of uncles in a block from a block matching the given block number
   * @param tag - query tag
   * @returns Uncle block count
   */
  getUncleCountByBlockNumber([tag]: [any]) {
    return this.apiServer.getUncleCountByBlockNumber(tag);
  }

  /**
   * Returns code at a given address
   * @param address - query address
   * @param tag - block tag
   * @returns Contract code
   */
  async getCode([address, tag]: [string, any]) {
    return this.apiServer.getCode(address, tag);
  }

  /**
   * Sign a message with an account
   * @param address - sign address
   * @param data - message data
   * @returns Signature
   */
  sign([address, data]: [string, string]) {
    return this.apiServer.sign(address, data);
  }

  /**
   * Signs a transaction that can be submitted to the network at a later time
   * @param data - transaction data
   * @returns Signed transaction
   */
  async signTransaction([data]: [CallData]) {
    return this.apiServer.signTransaction(data);
  }

  /**
   * Creates new message call transaction or a contract creation, if the data field contains code
   * @param data - transaction data
   * @returns Transaction hash
   */
  async sendTransaction([data]: [CallData]) {
    return this.apiServer.sendTransaction(data);
  }

  /**
   * Creates new message call transaction or a contract creation for signed transactions
   * @param rawtx - raw transaction
   * @returns Transaction hash
   */
  async sendRawTransaction([rawtx]: [string]) {
    return this.apiServer.sendRawTransaction(rawtx);
  }

  /**
   * Executes a new message call immediately without creating a transaction on the block chain.
   * @param data - transaction data
   * @param tag - block tag
   * @returns
   */
  async call([data, tag]: [CallData, any]) {
    return this.apiServer.call(data, tag);
  }

  /**
   * Generates and returns an estimate of how much gas is necessary to allow the transaction to complete
   * @param data - transaction data
   * @param tag - block tag
   * @returns Estimated gas limit
   */
  async estimateGas([data, tag]: [CallData, any]) {
    return this.apiServer.estimateGas(data, tag);
  }

  /**
   * Returns information about a block by hash
   * @param hash - block hash
   * @param fullTransactions - include full transactions or not
   * @returns Block data
   */
  async getBlockByHash([hash, fullTransactions]: [string, boolean]) {
    return this.apiServer.getBlockByHash(hash, fullTransactions);
  }

  /**
   * Returns information about a block by number.
   * @param tag - block tag
   * @param fullTransactions - include full transactions or not
   * @returns Block data
   */
  async getBlockByNumber([tag, fullTransactions]: [any, boolean]) {
    return this.apiServer.getBlockByNumber(tag, fullTransactions);
  }

  /**
   * Returns the information about a transaction requested by transaction hash
   * @param hash - transaction hash
   * @returns Transaction data
   */
  async getTransactionByHash([hash]: [string]) {
    return this.apiServer.getTransactionByHash(hash);
  }

  /**
   * Returns information about a transaction by block hash and transaction index position
   * @param hash - block hash
   * @param index - transaction index
   * @returns Transaction data
   */
  async getTransactionByBlockHashAndIndex([hash, index]: [string, string]) {
    return this.apiServer.getTransactionByBlockHashAndIndex(hash, index);
  }

  /**
   * Returns information about a transaction by block number and transaction index position
   * @param tag - block tag
   * @param index - transaction index
   * @returns Transaction data
   */
  async getTransactionByBlockNumberAndIndex([tag, index]: [any, string]) {
    return this.apiServer.getTransactionByBlockNumberAndIndex(tag, index);
  }

  /**
   * Returns the receipt of a transaction by transaction hash
   * @param hash - transaction hash
   * @returns Transaction receipt
   */
  async getTransactionReceipt([hash]: [string]) {
    return this.apiServer.getTransactionReceipt(hash);
  }

  /**
   * Returns information about a uncle of a block by hash and uncle index position
   * @returns Uncle block data
   */
  getUncleByBlockHashAndIndex() {
    return this.apiServer.getUncleByBlockHashAndIndex();
  }

  /**
   * Returns information about a uncle of a block by number and uncle index position
   * @returns Uncle block data
   */
  getUncleByBlockNumberAndIndex() {
    return this.apiServer.getUncleByBlockNumberAndIndex();
  }

  /**
   * Returns a list of available compilers in the client
   * @returns Compilers
   */
  getCompilers() {
    return this.apiServer.getCompilers();
  }

  /**
   * Returns compiled solidity code
   */
  compileSolidity() {
    return this.apiServer.compileSolidity();
  }

  /**
   * Returns compiled LLL code
   */
  compileLLL() {
    return this.apiServer.compileLLL();
  }

  /**
   * Returns compiled serpent code
   */
  compileSerpent() {
    return this.apiServer.compileSerpent();
  }

  /**
   * Creates a filter object, based on filter options, to notify when the state changes (logs)
   * @param param0 - filter parameters
   * @returns Filter id
   */
  async newFilter([{ fromBlock, toBlock, address: _addresses, topics: _topics }]: [{ fromBlock?: string; toBlock?: string; address?: string | string[]; topics?: TopicsData; blockhash?: string }]) {
    return this.apiServer.newFilter({ fromBlock, toBlock, address: _addresses, topics: _topics });
  }

  /**
   * Creates a filter in the node, to notify when a new block arrives
   * @returns Filter id
   */
  newBlockFilter() {
    return this.apiServer.newBlockFilter();
  }

  /**
   * Creates a filter in the node, to notify when new pending transactions arrive
   * @returns Filter id
   */
  newPendingTransactionFilter() {
    return this.apiServer.newPendingTransactionFilter();
  }

  /**
   * Uninstalls a filter with given id
   * @param id - filter id
   * @returns `true` if sucessfully deleted
   */
  uninstallFilter([id]: [string]) {
    return this.apiServer.uninstallFilter(id);
  }

  /**
   * Polling method for a filter, which returns an array of logs which occurred since last poll
   * @param id - filter id
   * @returns Filter changes
   */
  getFilterChanges([id]: [string]) {
    return this.apiServer.getFilterChanges(id);
  }

  /**
   * Returns an array of all logs matching filter with given id
   * @param id - filter id
   * @returns Filter logs
   */
  async getFilterLogs([id]: [string]) {
    return this.apiServer.getFilterLogs(id);
  }

  /**
   * Returns an array of all logs matching a given filter object
   * @param param0 - filter parameters
   * @returns Logs
   */
  async getLogs([{ fromBlock, toBlock, address: _addresses, topics: _topics, blockhash }]: [{ fromBlock?: string; toBlock?: string; address?: string | string[]; topics?: TopicsData; blockhash?: string }]) {
    return this.apiServer.getLogs({ fromBlock, toBlock, address: _addresses, topics: _topics, blockhash });
  }

  /**
   * Returns the hash of the current block, the seedHash, and the boundary condition to be met ("target").
   */
  getWork() {
    return this.apiServer.getWork();
  }

  /**
   * Used for submitting a proof-of-work solution.
   */
  submitWork() {
    return this.apiServer.submitWork();
  }

  /**
   * Used for submitting mining hashrate.
   */
  submitHashrate() {
    return this.apiServer.submitHashrate();
  }

  /**
   * Cancels an existing subscription so that no further events are sent.
   * @param id - subscription id
   * @returns `true` if subscription was successfully canceled
   */
  unsubscribe([id]: [string]) {
    return this.apiServer.unsubscribe(id);
  }

  // /**
  //  * Creates a new subscription for specified events
  //  * @param type  - subscription type
  //  * @param options - subscription options
  //  * @param client - subscription client
  //  * @returns Subscription id
  //  */
  // async subscribe([type, options]: [string, undefined | { address?: string | string[]; topics?: TopicsData }], client?: WebsocketClient) {
  //   return this.apiServer.subscribe(type, options, client);
  // }
}
