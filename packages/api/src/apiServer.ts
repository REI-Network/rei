import { Address, BN, bufferToHex, intToHex, bnToHex, hashPersonalMessage, toRpcSig, ecsign, setLengthLeft, keccakFromHexString } from 'ethereumjs-util';
import { hexStringToBN, hexStringToBuffer, ignoreError } from '@rei-network/utils';
import { Common } from '@rei-network/common';
import { Node } from '@rei-network/core';
import { StateManager } from '@rei-network/core/dist/stateManager';
import { TransactionFactory, Transaction, Block, Log } from '@rei-network/structure';
import { ERROR } from '@rei-network/vm/dist/exceptions';
import { revertErrorSelector, CallData, RevertError, OutOfGasError, parseAddressesAndTopics, TopicsData } from './types';
import { SimpleOracle } from './gasPriceOracle';
import { client, FilterSystem } from './filterSystem';

/**
 * Api server
 */
export class ApiServer {
  readonly node: Node;
  protected readonly oracle: SimpleOracle;
  protected readonly filterSystem: FilterSystem;

  constructor(node: Node) {
    this.node = node;
    this.oracle = new SimpleOracle(node);
    this.filterSystem = new FilterSystem(node);
  }

  /**
   * Start oracle and filter system
   */
  start() {
    this.oracle.start();
    this.filterSystem.start();
  }

  /**
   * Abort oracle and filter system
   */
  async abort() {
    await ignoreError(this.filterSystem.abort());
    this.oracle.abort();
  }

  protected async getBlockNumberByTag(tag: any): Promise<BN> {
    if (tag === 'earliest') {
      return new BN(0);
    } else if (tag === 'latest' || tag === undefined) {
      return this.node.getLatestBlock().header.number.clone();
    } else if (tag === 'pending') {
      return this.node.getLatestBlock().header.number.addn(1);
    } else if (tag.startsWith('0x')) {
      return hexStringToBN(tag);
    } else {
      throw new Error('Invalid tag value');
    }
  }

  protected async getBlockByTag(tag: any): Promise<Block> {
    let block!: Block;
    if (typeof tag === 'string') {
      if (tag === 'earliest') {
        block = await this.node.db.getBlock(0);
      } else if (tag === 'latest') {
        block = this.node.getLatestBlock();
      } else if (tag === 'pending') {
        block = this.node.getPendingBlock();
      } else if (tag.startsWith('0x')) {
        block = await this.node.db.getBlock(hexStringToBN(tag));
      } else {
        throw new Error('Invalid tag value');
      }
    } else if (typeof tag === 'object') {
      if ('blockNumber' in tag) {
        block = await this.node.db.getBlock(hexStringToBN(tag.blockNumber));
      } else if ('blockHash' in tag) {
        block = await this.node.db.getBlock(hexStringToBuffer(tag.blockHash));
      } else {
        throw new Error('Invalid tag value');
      }
    } else if (tag === undefined) {
      block = this.node.getLatestBlock();
    } else {
      throw new Error('Invalid tag value');
    }
    return block;
  }

  protected async getStateManagerByTag(tag: any): Promise<StateManager> {
    if (tag === 'pending') {
      return this.node.getPendingStateManager();
    } else {
      const block = await this.getBlockByTag(tag);
      return this.node.getStateManager(block.header.stateRoot, block.header.number);
    }
  }

  protected async runCall(data: CallData, tag: any) {
    const block = tag instanceof Block ? tag : await this.getBlockByTag(tag);
    const gas = data.gas ? hexStringToBN(data.gas) : new BN(0xffffff);
    const vm = await this.node.getVM(block.header.stateRoot, block.header.number);
    await vm.stateManager.checkpoint();
    try {
      const result = await vm.runCall({
        block: block as any,
        gasPrice: data.gasPrice ? hexStringToBN(data.gasPrice) : undefined,
        origin: data.from ? Address.fromString(data.from) : Address.zero(),
        caller: data.from ? Address.fromString(data.from) : Address.zero(),
        gasLimit: data.gas ? hexStringToBN(data.gas) : undefined,
        to: data.to ? Address.fromString(data.to) : undefined,
        value: data.value ? hexStringToBN(data.value) : undefined,
        data: data.data ? hexStringToBuffer(data.data) : undefined
      });

      // handling specific types of errors
      const error = result.execResult.exceptionError;
      if (error) {
        if (error.error === ERROR.OUT_OF_GAS) {
          throw new OutOfGasError(gas);
        } else if (error.error === ERROR.REVERT) {
          const returnValue = result.execResult.returnValue;
          if (returnValue.length > 4 && returnValue.slice(0, 4).equals(revertErrorSelector)) {
            throw new RevertError(returnValue);
          } else {
            throw new RevertError('unknown error');
          }
        } else {
          throw error;
        }
      }

      await vm.stateManager.revert();
      return result;
    } catch (err) {
      await vm.stateManager.revert();
      throw err;
    }
  }

  // Debug API
  /**
   * Trace a block by blockrlp data
   * @param blockRlp - block rlp encoded data
   * @param options - options
   * @returns Result of execution block
   */
  debug_traceBlock(blockRlp: Buffer, options: any) {
    return this.node.getTracer().traceBlock(blockRlp, options);
  }

  /**
   * Trace a block by block number
   * @param tag - block tag
   * @param options - options
   * @returns Result of execution block
   */
  async debug_traceBlockByNumber(tag: string, options: any) {
    return this.node.getTracer().traceBlock(await this.getBlockByTag(tag), options);
  }

  /**
   * Trace a block by block hash
   * @param hash  - block hash
   * @param options - options
   * @returns Result of execution block
   */
  debug_traceBlockByHash(hash: string, options: any) {
    return this.node.getTracer().traceBlockByHash(hexStringToBuffer(hash), options);
  }

  /**
   * Trace a transaction by transaction hash
   * @param hash - transaction hash
   * @param options - options
   * @returns Result of execution transaction
   */
  debug_traceTransaction(hash: string, options: any) {
    return this.node.getTracer().traceTx(hexStringToBuffer(hash), options);
  }

  /**
   * Trace given transaction by call vm.runCall fucntion
   * @param data - call data
   * @param tag - block tag
   * @param options - options
   * @returns Result of execution transaction
   */
  async debug_traceCall(data: CallData, tag: string, options: any) {
    return this.node.getTracer().traceCall(data, await this.getBlockByTag(tag), options);
  }

  //Eth API
  /**
   * Returns the current protocol version.
   * @returns The current client version
   */
  eth_protocolVersion() {
    return '1';
  }

  /**
   *  Returns an object with data about the sync status or false.
   * @returns The syncing status.
   */
  eth_syncing() {
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
  eth_chainId() {
    return bnToHex(this.node.getCommon(0).chainIdBN());
  }

  /**
   * Returns the client coinbase address.
   * @returns The coinbase address
   */
  eth_coinbase() {
    return this.node.getCurrentEngine().coinbase.toString();
  }

  /**
   * Returns true if client is actively mining new blocks.
   * @returns True if the node is currently mining, otherwise false
   */
  eth_mining() {
    return this.node.getCurrentEngine().enable;
  }

  /**
   * Returns the number of hashes per second that the node is mining with
   * @returns The node's hashrate
   */
  eth_hashrate() {
    return intToHex(0);
  }

  /**
   *  Returns the current price per gas in wei
   * @returns Gas price
   */
  eth_gasPrice() {
    return bnToHex(this.oracle.gasPrice);
  }

  /**
   * Returns a list of addresses owned by client
   * @returns Accounts list
   */
  eth_accounts() {
    return this.node.accMngr.totalUnlockedAccounts().map((addr) => bufferToHex(addr));
  }

  /**
   * Returns the number of most recent block
   * @returns Latest block number
   */
  eth_blockNumber() {
    return bnToHex(this.node.getLatestBlock().header.number);
  }

  /**
   * Returns the balance of the account of given address
   * @param address - query address
   * @param tag - block tag
   * @returns Balance of the account
   */
  async eth_getBalance(address: string, tag: any) {
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
  async eth_getStorageAt(address: string, key: string, tag: any) {
    const stateManager = await this.getStateManagerByTag(tag);
    return bufferToHex(await stateManager.getContractStorage(Address.fromString(address), setLengthLeft(hexStringToBuffer(key), 32)));
  }

  /**
   * Returns the number of transactions sent from an address
   * @param address - query address
   * @param tag - block tag
   * @returns Nonce of the account
   */
  async eth_getTransactionCount(address: string, tag: any) {
    const stateManager = await this.getStateManagerByTag(tag);
    const account = await stateManager.getAccount(Address.fromString(address));
    return bnToHex(account.nonce);
  }

  /**
   * Returns the number of transactions in a block from a block matching the given block hash.
   * @param hash - query hash
   * @returns Transaction count
   */
  async eth_getBlockTransactionCountByHash(hash: string) {
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
  async eth_getBlockTransactionCountByNumber(tag: any) {
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
  eth_getUncleCountByBlockHash(hash: string) {
    return intToHex(0);
  }

  /**
   * Returns the number of uncles in a block from a block matching the given block number
   * @param tag - query tag
   * @returns Uncle block count
   */
  eth_getUncleCountByBlockNumber(tag: any) {
    return intToHex(0);
  }

  /**
   * Returns code at a given address
   * @param address - query address
   * @param tag - block tag
   * @returns Contract code
   */
  async eth_getCode(address: string, tag: any) {
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
  eth_sign(address: string, data: string) {
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
  async eth_signTransaction(data: CallData) {
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
  async eth_sendTransaction(data: CallData) {
    const tx = await this.makeTxForUnlockedAccount(data);
    if (!(tx instanceof Transaction)) {
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
  async eth_sendRawTransaction(rawtx: string) {
    const tx = TransactionFactory.fromSerializedData(hexStringToBuffer(rawtx), { common: this.node.getLatestCommon() });
    if (!(tx instanceof Transaction)) {
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
  async eth_call(data: CallData, tag: any) {
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
  async eth_estimateGas(data: CallData, tag: any) {
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
  async eth_getBlockByHash(hash: string, fullTransactions: boolean) {
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
  async eth_getBlockByNumber(tag: any, fullTransactions: boolean) {
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
  async eth_getTransactionByHash(hash: string) {
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
  async eth_getTransactionByBlockHashAndIndex(hash: string, index: string) {
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
  async eth_getTransactionByBlockNumberAndIndex(tag: any, index: string) {
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
  async eth_getTransactionReceipt(hash: string) {
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
  eth_getUncleByBlockHashAndIndex() {
    return null;
  }

  /**
   * Returns information about a uncle of a block by number and uncle index position
   * @returns Uncle block data
   */
  eth_getUncleByBlockNumberAndIndex() {
    return null;
  }

  /**
   * Returns a list of available compilers in the client
   * @returns Compilers
   */
  eth_getCompilers() {
    return [];
  }

  /**
   * Returns compiled solidity code
   */
  eth_compileSolidity() {
    throw new Error('Unsupported compiler!');
  }

  /**
   * Returns compiled LLL code
   */
  eth_compileLLL() {
    throw new Error('Unsupported compiler!');
  }

  /**
   * Returns compiled serpent code
   */
  eth_compileSerpent() {
    throw new Error('Unsupported compiler!');
  }

  /**
   * Creates a filter object, based on filter options, to notify when the state changes (logs)
   * @param param0 - filter parameters
   * @returns Filter id
   */
  async eth_newFilter({ fromBlock, toBlock, address: _addresses, topics: _topics }: { fromBlock?: string; toBlock?: string; address?: string | string[]; topics?: TopicsData; blockhash?: string }) {
    const from = await this.getBlockNumberByTag(fromBlock ? fromBlock : 'latest');
    const to = await this.getBlockNumberByTag(toBlock ? toBlock : 'latest');
    const { addresses, topics } = parseAddressesAndTopics(_addresses, _topics);
    return this.filterSystem.newFilter('logs', { fromBlock: from, toBlock: to, addresses, topics });
  }

  /**
   * Creates a filter in the node, to notify when a new block arrives
   * @returns Filter id
   */
  eth_newBlockFilter() {
    return this.filterSystem.newFilter('newHeads');
  }

  /**
   * Creates a filter in the node, to notify when new pending transactions arrive
   * @returns Filter id
   */
  eth_newPendingTransactionFilter() {
    return this.filterSystem.newFilter('newPendingTransactions');
  }

  /**
   * Uninstalls a filter with given id
   * @param id - filter id
   * @returns `true` if sucessfully deleted
   */
  eth_uninstallFilter(id: string) {
    return this.filterSystem.uninstall(id);
  }

  /**
   * Polling method for a filter, which returns an array of logs which occurred since last poll
   * @param id - filter id
   * @returns Filter changes
   */
  eth_getFilterChanges(id: string) {
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
  async eth_getFilterLogs(id: string) {
    const query = this.filterSystem.getFilterQuery(id);
    if (!query) {
      return [];
    }
    const { fromBlock, toBlock, addresses, topics } = query;
    const from = await this.getBlockNumberByTag(fromBlock ?? 'latest');
    const to = await this.getBlockNumberByTag(toBlock ?? 'latest');
    if (to.sub(from).gtn(5000)) {
      throw new Error('eth_getFilterLogs, too many block, max limit is 5000');
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
  async eth_getLogs({ fromBlock, toBlock, address: _addresses, topics: _topics, blockhash }: { fromBlock?: string; toBlock?: string; address?: string | string[]; topics?: TopicsData; blockhash?: string }) {
    const from = await this.getBlockNumberByTag(fromBlock ?? 'latest');
    const to = await this.getBlockNumberByTag(toBlock ?? 'latest');
    if (to.sub(from).gtn(5000)) {
      throw new Error('eth_getLogs, too many block, max limit is 5000');
    }

    const { addresses, topics } = parseAddressesAndTopics(_addresses, _topics);
    const filter = this.node.getFilter();
    const logs = blockhash ? await filter.filterBlock(hexStringToBuffer(blockhash), addresses, topics) : await filter.filterRange(from, to, addresses, topics);
    return logs.map((log) => log.toRPCJSON());
  }

  /**
   * Returns the hash of the current block, the seedHash, and the boundary condition to be met ("target").
   */
  eth_getWork() {
    throw new Error('Unsupported eth_getWork!');
  }

  /**
   * Used for submitting a proof-of-work solution.
   */
  eth_submitWork() {
    throw new Error('Unsupported eth_submitWork!');
  }

  /**
   * Used for submitting mining hashrate.
   */
  eth_submitHashrate() {
    throw new Error('Unsupported eth_submitHashrate!');
  }

  /**
   * Cancels an existing subscription so that no further events are sent.
   * @param id - subscription id
   * @returns `true` if subscription was successfully canceled
   */
  eth_unsubscribe(id: string) {
    return this.filterSystem.unsubscribe(id);
  }

  /**
   * Creates a new subscription for specified events
   * @param type  - subscription type
   * @param options - subscription options
   * @param client - subscription client
   * @returns Subscription id
   */
  async eth_subscribe(type: string, options: undefined | { address?: string | string[]; topics?: TopicsData }, client?: client) {
    if (!client) {
      throw new Error('eth_subscribe is only supported on websocket!');
    }

    if (type !== 'newHeads' && type !== 'logs' && type !== 'newPendingTransactions' && type !== 'syncing') {
      throw new Error('eth_subscribe, invalid subscription type!');
    }

    if (type === 'logs') {
      return this.filterSystem.subscribe(client, type, parseAddressesAndTopics(options?.address, options?.topics));
    } else {
      return this.filterSystem.subscribe(client, type);
    }
  }

  // Rei API
  /**
   * Estimate user available crude
   * @param address - Target address
   * @param tag - Block tag
   * @returns Available crude
   */
  async rei_getCrude(address: string, tag: string) {
    const block = await this.getBlockByTag(tag);
    const common = block._common;
    const strDailyFee = common.param('vm', 'dailyFee');
    if (typeof strDailyFee !== 'string') {
      return null;
    }

    const state = await this.node.getStateManager(block.header.stateRoot, common);
    const faddr = Address.fromString(common.param('vm', 'faddr'));
    const totalAmount = (await state.getAccount(faddr)).balance;
    const timestamp = block.header.timestamp.toNumber();
    const dailyFee = hexStringToBN(strDailyFee);

    const account = await state.getAccount(Address.fromString(address));
    const stakeInfo = account.getStakeInfo();
    return bnToHex(stakeInfo.estimateFee(timestamp, totalAmount, dailyFee));
  }

  /**
   * Estimate user used crude
   * @param address - Target address
   * @param tag - Block tag
   * @returns Used crude
   */
  async rei_getUsedCrude(address: string, tag: string) {
    const block = await this.getBlockByTag(tag);
    const timestamp = block.header.timestamp.toNumber();
    const state = await this.node.getStateManager(block.header.stateRoot, block._common);
    const account = await state.getAccount(Address.fromString(address));
    const stakeInfo = account.getStakeInfo();
    return bnToHex(stakeInfo.estimateUsage(timestamp));
  }

  /**
   * Get the total deposit amount of the user
   * @param address - Target address
   * @param tag - Block tag
   * @returns Total deposit amount
   */
  async rei_getTotalAmount(address: string, tag: string) {
    const stateManager = await this.getStateManagerByTag(tag);
    const account = await stateManager.getAccount(Address.fromString(address));
    const stakeInfo = account.getStakeInfo();
    return bnToHex(stakeInfo.total);
  }

  /**
   * Read "dailyFee" settings from common
   * @param tag - Block tag
   * @returns Daily fee
   */
  async rei_getDailyFee(tag: string) {
    const num = await this.getBlockNumberByTag(tag);
    const common = this.node.getCommon(num);
    const strDailyFee = common.param('vm', 'dailyFee');
    if (typeof strDailyFee !== 'string') {
      return null;
    }
    return bnToHex(hexStringToBN(strDailyFee));
  }

  /**
   * Read "minerRewardFactor" settings from common
   * @param tag - Block tag
   * @returns Miner reward factor
   */
  async rei_getMinerRewardFactor(tag: string) {
    const num = await this.getBlockNumberByTag(tag);
    const common = this.node.getCommon(num);
    const factor = common.param('vm', 'minerRewardFactor');
    if (typeof factor !== 'number' || factor < 0 || factor > 100) {
      return null;
    }
    return intToHex(factor);
  }

  /**
   * Get total pool content
   * @returns An object containing all transactions in the pool
   */
  txpool_content() {
    return this.node.txPool.getPoolContent();
  }

  /**
   * Get client version
   * @returns version data
   */
  web3_clientVersion() {
    return 'Mist/v0.0.1';
  }

  /**
   * Calulate the sha3 of a given string
   * @param data - Data to calulate hash
   * @returns Hash
   */
  web_sha3(data: string) {
    return bufferToHex(keccakFromHexString(data));
  }

  /**
   * Get the current network id
   * @returns Network id
   */
  net_version() {
    return this.node.chainId.toString();
  }

  /**
   * Returns true if client is actively listening for network connections
   * @returns network connections state
   */
  net_listening() {
    return true;
  }

  /**
   * Returns number of peers currently connected to the client
   * @returns number of peers
   */
  net_peerCount() {
    return intToHex(this.node.networkMngr.peers.length);
  }
}
