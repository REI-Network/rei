import { Address, BN, bufferToHex, intToHex, bnToHex, hashPersonalMessage, toRpcSig, ecsign, setLengthLeft, keccakFromHexString } from 'ethereumjs-util';
import { hexStringToBN, hexStringToBuffer } from '@rei-network/utils';
import { RpcServer } from '@rei-network/rpc';
import { Common } from '@rei-network/common';
import { TransactionFactory, Log, Transaction, Block } from '@rei-network/structure';
import { StateManager } from '@rei-network/rpc/dist/types';
import { ERROR } from '@rei-network/vm/dist/exceptions';
import { revertErrorSelector, CallData, RevertError, OutOfGasError, parseAddressesAndTopics, TopicsData } from './types';
import { WebsocketClient } from '@rei-network/rpc/dist/client';

export class ApiServer {
  protected readonly server: RpcServer;
  constructor(server: RpcServer) {
    this.server = server;
  }

  get backend() {
    return this.server.backend;
  }

  get filterSystem() {
    return this.server.filterSystem;
  }

  get oracle() {
    return this.server.oracle;
  }

  protected async getBlockNumberByTag(tag: any): Promise<BN> {
    if (tag === 'earliest') {
      return new BN(0);
    } else if (tag === 'latest' || tag === undefined) {
      return this.backend.getLatestBlock().header.number.clone();
    } else if (tag === 'pending') {
      return this.backend.getLatestBlock().header.number.addn(1);
    } else if (tag.startsWith('0x')) {
      return hexStringToBN(tag);
    } else {
      //TODO throw err Invalid tag value
      // for types.
      return new BN(0);
    }
  }

  protected async getBlockByTag(tag: any): Promise<Block> {
    let block!: Block;
    if (typeof tag === 'string') {
      if (tag === 'earliest') {
        block = await this.backend.db.getBlock(0);
      } else if (tag === 'latest') {
        block = this.backend.getLatestBlock();
      } else if (tag === 'pending') {
        block = this.backend.getPendingBlock();
      } else if (tag.startsWith('0x')) {
        block = await this.backend.db.getBlock(hexStringToBN(tag));
      } else {
        // helper.throwRpcErr('Invalid tag value');
        //TODO throw err Invalid tag value
      }
    } else if (typeof tag === 'object') {
      if ('blockNumber' in tag) {
        block = await this.backend.db.getBlock(hexStringToBN(tag.blockNumber));
      } else if ('blockHash' in tag) {
        block = await this.backend.db.getBlock(hexStringToBuffer(tag.blockHash));
      } else {
        //TODO throw err Invalid tag value
      }
    } else if (tag === undefined) {
      block = this.backend.getLatestBlock();
    } else {
      //TODO throw err Invalid tag value
    }
    return block;
  }

  protected async getStateManagerByTag(tag: any): Promise<StateManager> {
    if (tag === 'pending') {
      return this.backend.getPendingStateManager();
    } else {
      const block = await this.getBlockByTag(tag);
      return this.backend.getStateManager(block.header.stateRoot, block.header.number);
    }
  }

  protected async runCall(data: CallData, tag: any) {
    const block = tag instanceof Block ? tag : await this.getBlockByTag(tag);
    const gas = data.gas ? hexStringToBN(data.gas) : new BN(0xffffff);
    const vm = await this.backend.getVM(block.header.stateRoot, block.header.number);
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
          // throw new OutOfGasError(gas);
          // TODO error
        } else if (error.error === ERROR.REVERT) {
          const returnValue = result.execResult.returnValue;
          if (returnValue.length > 4 && returnValue.slice(0, 4).equals(revertErrorSelector)) {
            // throw new RevertError(returnValue);
            // error
          } else {
            // throw new RevertError('unknown error');
            error;
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

  debug_traceBlock(blockRlp: Buffer, options: any) {
    return this.backend.getTracer().traceBlock(blockRlp, options);
  }

  async debug_traceBlockByNumber(tag: string, options: any) {
    return this.backend.getTracer().traceBlock(await this.getBlockByTag(tag), options);
  }

  debug_traceBlockByHash(hash: string, options: any) {
    return this.backend.getTracer().traceBlockByHash(hexStringToBuffer(hash), options);
  }

  debug_traceTransaction(hash: string, options: any) {
    return this.backend.getTracer().traceTx(hexStringToBuffer(hash), options);
  }

  async debug_traceCall(data: CallData, tag: string, options: any) {
    return this.backend.getTracer().traceCall(data, await this.getBlockByTag(tag), options);
  }

  eth_protocolVersion() {
    return '1';
  }

  eth_syncing() {
    if (!this.backend.sync.isSyncing) {
      return false;
    }
    const status = this.backend.sync.status;
    return {
      startingBlock: intToHex(status.startingBlock),
      currentBlock: bnToHex(this.backend.getLatestBlock().header.number),
      highestBlock: intToHex(status.highestBlock)
    };
  }

  eth_chainId() {
    return bnToHex(this.backend.getCommon(0).chainIdBN());
  }

  eth_coinbase() {
    return this.backend.getCurrentEngine().coinbase.toString();
  }

  eth_mining() {
    return this.backend.getCurrentEngine().enable;
  }

  eth_hashrate() {
    return intToHex(0);
  }

  eth_gasPrice() {
    return bnToHex(this.oracle.gasPrice);
  }

  eth_accounts() {
    return this.backend.accMngr.totalUnlockedAccounts().map((addr) => bufferToHex(addr));
  }

  eth_blockNumber() {
    return bnToHex(this.backend.getLatestBlock().header.number);
  }

  async eth_getBalance(address: string, tag: any) {
    const stateManager = await this.getStateManagerByTag(tag);
    const account = await stateManager.getAccount(Address.fromString(address));
    return bnToHex(account.balance);
  }

  async eth_getStorageAt(address: string, key: string, tag: any) {
    const stateManager = await this.getStateManagerByTag(tag);
    return bufferToHex(await stateManager.getContractStorage(Address.fromString(address), setLengthLeft(hexStringToBuffer(key), 32)));
  }

  async eth_getTransactionCount(address: string, tag: any) {
    const stateManager = await this.getStateManagerByTag(tag);
    const account = await stateManager.getAccount(Address.fromString(address));
    return bnToHex(account.nonce);
  }

  async eth_getBlockTransactionCountByHash(hash: string) {
    try {
      const number = (await this.backend.db.getBlock(hexStringToBuffer(hash))).transactions.length;
      return intToHex(number);
    } catch (err) {
      return null;
    }
  }

  async eth_getBlockTransactionCountByNumber(tag: any) {
    try {
      const number = (await this.getBlockByTag(tag)).transactions.length;
      return intToHex(number);
    } catch (err) {
      return null;
    }
  }

  eth_getUncleCountByBlockHash(hash: string) {
    return intToHex(0);
  }

  eth_getUncleCountByBlockNumber(tag: any) {
    return intToHex(0);
  }

  async eth_getCode(address: string, tag: any) {
    const stateManager = await this.getStateManagerByTag(tag);
    const code = await stateManager.getContractCode(Address.fromString(address));
    return bufferToHex(code);
  }

  eth_sign(address: string, data: string) {
    const signature = ecsign(hashPersonalMessage(Buffer.from(data)), this.backend.accMngr.getPrivateKey(address));
    return toRpcSig(signature.v, signature.r, signature.s);
  }

  private async makeTxForUnlockedAccount(data: CallData) {
    if (!data.from) {
      // TODO
      // helper.throwRpcErr('Missing from');
      // for types.
      throw new Error();
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
      { common: this.backend.getLatestCommon() }
    );
    const privateKey = this.backend.accMngr.getPrivateKey(data.from);
    return unsignedTx.sign(privateKey);
  }

  async eth_signTransaction(data: CallData) {
    const tx = await this.makeTxForUnlockedAccount(data);
    if (!(tx instanceof Transaction)) {
      return null;
    }
    return bufferToHex(tx.serialize());
  }

  async eth_sendTransaction(data: CallData) {
    const tx = await this.makeTxForUnlockedAccount(data);
    if (!(tx instanceof Transaction)) {
      return null;
    }
    const results = await this.backend.addPendingTxs([tx]);
    return results.length > 0 && results[0] ? bufferToHex(tx.hash()) : null;
  }

  async eth_sendRawTransaction(rawtx: string) {
    const tx = TransactionFactory.fromSerializedData(hexStringToBuffer(rawtx), { common: this.backend.getLatestCommon() });
    if (!(tx instanceof Transaction)) {
      return null;
    }
    const results = await this.backend.addPendingTxs([tx]);
    return results.length > 0 && results[0] ? bufferToHex(tx.hash()) : null;
  }

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

  async eth_getBlockByHash(hash: string, fullTransactions: boolean) {
    try {
      return ((await this.backend.db.getBlock(hexStringToBuffer(hash))) as Block).toRPCJSON(false, fullTransactions);
    } catch (err) {
      return null;
    }
  }

  async eth_getBlockByNumber(tag: any, fullTransactions: boolean) {
    try {
      return (await this.getBlockByTag(tag)).toRPCJSON(tag === 'pending', fullTransactions);
    } catch (err) {
      return null;
    }
  }

  async eth_getTransactionByHash(hash: string) {
    const hashBuffer = hexStringToBuffer(hash);
    try {
      return ((await this.backend.db.getTransaction(hashBuffer)) as Transaction).toRPCJSON();
    } catch (err: any) {
      if (err.type !== 'NotFoundError') {
        throw err;
      }
    }
    const tx = this.backend.txPool.getTransaction(hashBuffer);
    if (!tx) {
      return null;
    }
    return tx.toRPCJSON();
  }

  async eth_getTransactionByBlockHashAndIndex(hash: string, index: string) {
    try {
      const block = await this.backend.db.getBlock(hexStringToBuffer(hash));
      const tx = block.transactions[Number(index)] as Transaction;
      tx.initExtension(block);
      return tx.toRPCJSON();
    } catch (err) {
      return null;
    }
  }

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

  async eth_getTransactionReceipt(hash: string) {
    try {
      return (await this.backend.db.getReceipt(hexStringToBuffer(hash))).toRPCJSON();
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
    // TODO
    // helper.throwRpcErr('Unsupported compiler!');
  }

  eth_compileLLL() {
    // TODO
    // helper.throwRpcErr('Unsupported compiler!');
  }

  eth_compileSerpent() {
    // TODO
    // helper.throwRpcErr('Unsupported compiler!');
  }

  async eth_newFilter({ fromBlock, toBlock, address: _addresses, topics: _topics }: { fromBlock?: string; toBlock?: string; address?: string | string[]; topics?: TopicsData; blockhash?: string }) {
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

  eth_uninstallFilter(id: string) {
    return this.filterSystem.uninstall(id);
  }

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

  async eth_getFilterLogs(id: string) {
    const query = this.filterSystem.getFilterQuery(id);
    if (!query) {
      return [];
    }
    const { fromBlock, toBlock, addresses, topics } = query;
    const from = await this.getBlockNumberByTag(fromBlock ?? 'latest');
    const to = await this.getBlockNumberByTag(toBlock ?? 'latest');
    if (to.sub(from).gtn(5000)) {
      // TODO: throw error
      // helper.throwRpcErr('eth_getFilterLogs, too many block, max limit is 5000');
    }

    const filter = this.backend.getFilter();
    const logs = await filter.filterRange(from, to, addresses, topics);
    return logs.map((log) => log.toRPCJSON());
  }
  async eth_getLogs([{ fromBlock, toBlock, address: _addresses, topics: _topics, blockhash }]: [{ fromBlock?: string; toBlock?: string; address?: string | string[]; topics?: TopicsData; blockhash?: string }]) {
    const from = await this.getBlockNumberByTag(fromBlock ?? 'latest');
    const to = await this.getBlockNumberByTag(toBlock ?? 'latest');
    if (to.sub(from).gtn(5000)) {
      //  TODO: throw error
      // helper.throwRpcErr('eth_getLogs, too many block, max limit is 5000');
    }

    const { addresses, topics } = parseAddressesAndTopics(_addresses, _topics);
    const filter = this.backend.getFilter();
    const logs = blockhash ? await filter.filterBlock(hexStringToBuffer(blockhash), addresses, topics) : await filter.filterRange(from, to, addresses, topics);
    return logs.map((log) => log.toRPCJSON());
  }
  eth_getWork() {
    // TODO
    // helper.throwRpcErr('Unsupported eth_getWork!');
  }

  eth_submitWork() {
    // TODO
    // helper.throwRpcErr('Unsupported eth_submitWork!');
  }

  eth_submitHashrate() {
    // TODO
    // helper.throwRpcErr('Unsupported eth_submitHashrate!');
  }

  eth_unsubscribe(id: string) {
    return this.filterSystem.unsubscribe(id);
  }

  async eth_subscribe(type: string, options: undefined | { address?: string | string[]; topics?: TopicsData }, client?: WebsocketClient) {
    if (!client) {
      // TODO
      // throw helper.throwRpcErr('eth_subscribe is only supported on websocket!');
    }

    if (type !== 'newHeads' && type !== 'logs' && type !== 'newPendingTransactions' && type !== 'syncing') {
      // TODO
      // throw helper.throwRpcErr('eth_subscribe, invalid subscription type!');
    }

    if (type === 'logs') {
      return this.filterSystem.subscribe(client, type, parseAddressesAndTopics(options?.address, options?.topics));
    } else {
      return this.filterSystem.subscribe(client, type);
    }
  }

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

    const state = await this.backend.getStateManager(block.header.stateRoot, common);
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
    const state = await this.backend.getStateManager(block.header.stateRoot, block._common);
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
    const common = this.backend.getCommon(num);
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
    const common = this.backend.getCommon(num);
    const factor = common.param('vm', 'minerRewardFactor');
    if (typeof factor !== 'number' || factor < 0 || factor > 100) {
      return null;
    }
    return intToHex(factor);
  }

  txpool_content() {
    return this.backend.txPool.getPoolContent();
  }

  web3_clientVersion() {
    return 'Mist/v0.0.1';
  }

  web_sha3(data: string) {
    return bufferToHex(keccakFromHexString(data));
  }

  net_version() {
    return this.backend.chainId.toString();
  }

  net_listenging() {
    return true;
  }

  net_peerCount() {
    return intToHex(this.backend.networkMngr.peers.length);
  }
}
