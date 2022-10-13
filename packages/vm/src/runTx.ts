import { debug as createDebugLogger } from 'debug';
import { Address, BN, toBuffer } from 'ethereumjs-util';
import { Block, AccessList, AccessListItem, AccessListEIP2930Transaction, FeeMarketEIP1559Transaction, Transaction, TypedTransaction, Capability } from '@rei-network/structure';
import { ConsensusType } from '@rei-network/common';
import { AccessList as EVMCAccessList } from '../../binding';
import { VM } from './index';
import Bloom from './bloom';
import { default as EVM, EVMResult } from './evm/evm';
import { short } from './evm/opcodes/util';
import Message from './evm/message';
import TxContext from './evm/txContext';
import { getActivePrecompiles } from './evm/precompiles';
import { EIP2929StateManager } from './state/interface';
import type { TxReceipt, BaseTxReceipt, PreByzantiumTxReceipt, PostByzantiumTxReceipt, IDebug } from './types';
import { StateManager } from './state';

const debug = createDebugLogger('vm:tx');
const debugGas = createDebugLogger('vm:tx:gas');

/**
 * Options for the `runTx` method.
 */
export interface RunTxOpts {
  /**
   * The `block` the `tx` belongs to.
   * If omitted, a default blank block will be used.
   */
  block?: Block;
  /**
   * The `tx` to run
   */
  tx: TypedTransaction;
  /**
   * If true, skips the nonce check
   */
  skipNonce?: boolean;
  /**
   * If true, skips the balance check
   */
  skipBalance?: boolean;

  /**
   * If true, skips the validation of the tx's gas limit
   * agains the block's gas limit.
   */
  skipBlockGasLimitValidation?: boolean;

  /**
   * If true, adds a generated EIP-2930 access list
   * to the `RunTxResult` returned.
   *
   * Option works with all tx types. EIP-2929 needs to
   * be activated (included in `berlin` HF).
   *
   * Note: if this option is used with a custom {@link StateManager} implementation
   * {@link StateManager.generateAccessList} must be implemented.
   */
  reportAccessList?: boolean;

  /**
   * To obtain an accurate tx receipt input the block gas used up until this tx.
   */
  blockGasUsed?: BN;

  /**
   * Debug callback
   */
  debug?: IDebug;

  /**
   * Recent hashes
   */
  recentHashes?: Buffer[];

  /**
   * Before tx callback
   */
  beforeTx?: (stateManager: StateManager, tx: TypedTransaction, txCost: BN) => Promise<void>;

  /**
   * After tx callback;
   */
  afterTx?: (stateManager: StateManager, tx: TypedTransaction, actualTxCost: BN) => Promise<void>;

  /**
   * Assign tx reward to miner callback
   */
  assignTxReward?: (stateManager: StateManager, value: BN) => Promise<void>;

  /**
   * Generate tx receipt callback
   */
  generateTxReceipt?: (this: VM, tx: TypedTransaction, txResult: RunTxResult, cumulativeGasUsed: BN) => Promise<TxReceipt>;
}

/**
 * Execution result of a transaction
 */
export interface RunTxResult extends EVMResult {
  /**
   * Bloom filter resulted from transaction
   */
  bloom: Bloom;

  /**
   * The amount of ether used by this transaction
   */
  amountSpent: BN;

  /**
   * The tx receipt
   */
  receipt: TxReceipt;

  /**
   * The amount of gas as that was refunded during the transaction (i.e. `gasUsed = totalGasConsumed - gasRefund`)
   */
  gasRefund?: BN;

  /**
   * EIP-2930 access list generated for the tx (see `reportAccessList` option)
   */
  accessList?: AccessList;
}

export interface AfterTxEvent extends RunTxResult {
  /**
   * The transaction which just got finished
   */
  transaction: TypedTransaction;
}

/**
 * @ignore
 */
export default async function runTx(this: VM, opts: RunTxOpts): Promise<RunTxResult> {
  // tx is required
  if (!opts.tx) {
    throw new Error('invalid input, tx is required');
  }

  // create a reasonable default if no block is given
  opts.block = opts.block ?? Block.fromBlockData({}, { common: opts.tx.common });

  if (!opts.recentHashes) {
    opts.recentHashes = [];
    const number = opts.block.header.number;
    const db = this.blockchain.database;
    for (let i = number.subn(1); i.gten(0) && i.gte(number.subn(256)); i.isubn(1)) {
      opts.recentHashes.push(await db.numberToHash(i));
    }
  }

  if (opts.skipBlockGasLimitValidation !== true && opts.block.header.gasLimit.lt(opts.tx.gasLimit)) {
    throw new Error('tx has a higher gas limit than the block');
  }

  // Have to cast as `EIP2929StateManager` to access clearWarmedAccounts
  const state: EIP2929StateManager = <EIP2929StateManager>this.stateManager;
  if (opts.reportAccessList && !('generateAccessList' in state)) {
    throw new Error('reportAccessList needs a StateManager implementing the generateAccessList() method');
  }

  // Ensure we start with a clear warmed accounts Map
  if (this._common.isActivatedEIP(2929)) {
    state.clearWarmedAccounts();
  }

  await state.checkpoint();
  if (this.DEBUG) {
    debug('-'.repeat(100));
    debug('tx checkpoint');
  }

  let accessList: EVMCAccessList | undefined = undefined;

  // Typed transaction specific setup tasks
  if (opts.tx.supports(Capability.EIP2718TypedTransaction) && this._common.isActivatedEIP(2718)) {
    // Is it an Access List transaction?
    if (!this._common.isActivatedEIP(2930)) {
      await state.revert();
      throw new Error('Cannot run transaction: EIP 2930 is not activated.');
    }
    if (opts.reportAccessList && !('generateAccessList' in state)) {
      await state.revert();
      throw new Error('StateManager needs to implement generateAccessList() when running with reportAccessList option');
    }
    if (opts.tx.supports(Capability.EIP1559FeeMarket) && !this._common.isActivatedEIP(1559)) {
      await state.revert();
      throw new Error('Cannot run transaction: EIP 1559 is not activated.');
    }

    const castedTx = <AccessListEIP2930Transaction>opts.tx;

    accessList = [];
    for (const accessListItem of castedTx.AccessListJSON) {
      accessList.push([accessListItem.address, accessListItem.storageKeys]);
    }

    castedTx.AccessListJSON.forEach((accessListItem: AccessListItem) => {
      const address = toBuffer(accessListItem.address);
      state.addWarmedAddress(address);
      accessListItem.storageKeys.forEach((storageKey: string) => {
        state.addWarmedStorage(address, toBuffer(storageKey));
      });
    });
  }

  try {
    const result = await _runTx.bind(this)(opts);
    await state.commit();
    if (this.DEBUG) {
      debug('tx checkpoint committed');
    }
    if (this._common.isActivatedEIP(2929) && opts.reportAccessList) {
      const { tx } = opts;
      // Do not include sender address in access list
      const removed = [tx.getSenderAddress()];
      // Only include to address on present storage slot accesses
      const onlyStorage = tx.to ? [tx.to] : [];
      result.accessList = state.generateAccessList!(removed, onlyStorage);
    }
    return result;
  } catch (e) {
    await state.revert();
    if (this.DEBUG) {
      debug('tx checkpoint reverted');
    }
    throw e;
  } finally {
    if (this._common.isActivatedEIP(2929)) {
      state.clearWarmedAccounts();
    }
  }
}

async function _runTx(this: VM, opts: RunTxOpts, accessList?: EVMCAccessList): Promise<RunTxResult> {
  // Casted as `any` to access the EIP2929 methods
  const state: any = this.stateManager;
  const { tx, block, blockGasUsed, recentHashes, debug: debugContext } = opts;

  if (!block) {
    throw new Error('block required');
  }

  /**
   * The `beforeTx` event
   *
   * @event Event: beforeTx
   * @type {Object}
   * @property {Transaction} tx emits the Transaction that is about to be processed
   */
  await this._emit('beforeTx', tx);

  const caller = tx.getSenderAddress();
  if (this.DEBUG) {
    debug(`New tx run hash=${opts.tx.isSigned() ? opts.tx.hash().toString('hex') : 'unsigned'} sender=${caller.toString()}`);
  }

  if (this._common.isActivatedEIP(2929)) {
    // Add origin and precompiles to warm addresses
    getActivePrecompiles(this._common).forEach((address: Address) => state.addWarmedAddress(address.buf));
    state.addWarmedAddress(caller.buf);
    if (tx.to) {
      // Note: in case we create a contract, we do this in EVMs `_executeCreate` (this is also correct in inner calls, per the EIP)
      state.addWarmedAddress(tx.to.buf);
    }
  }

  // Validate gas limit against base fee
  const basefee = tx.getBaseFee();
  const gasLimit = tx.gasLimit.clone();
  if (gasLimit.lt(basefee)) {
    throw new Error('base fee exceeds gas limit');
  }
  gasLimit.isub(basefee);
  if (this.DEBUG) {
    debugGas(`Subtracting base fee (${basefee}) from gasLimit (-> ${gasLimit})`);
  }

  if (this._common.isActivatedEIP(1559)) {
    // EIP-1559 spec:
    // Ensure that the user was willing to at least pay the base fee
    // assert transaction.max_fee_per_gas >= block.base_fee_per_gas
    const maxFeePerGas = 'maxFeePerGas' in tx ? tx.maxFeePerGas : tx.gasPrice;
    const baseFeePerGas = block.header.baseFeePerGas!;
    if (maxFeePerGas.lt(baseFeePerGas)) {
      throw new Error(`Transaction's maxFeePerGas (${maxFeePerGas}) is less than the block's baseFeePerGas (${baseFeePerGas})`);
    }
  }

  // Check from account's balance and nonce
  let fromAccount = await state.getAccount(caller);
  const { nonce, balance } = fromAccount;

  if (!opts.skipBalance) {
    const cost = tx.getUpfrontCost(block.header.baseFeePerGas);
    if (balance.lt(cost)) {
      throw new Error(`sender doesn't have enough funds to send tx. The upfront cost is: ${cost} and the sender's account only has: ${balance}`);
    }
    if (tx.supports(Capability.EIP1559FeeMarket)) {
      // EIP-1559 spec:
      // The signer must be able to afford the transaction
      // `assert balance >= gas_limit * max_fee_per_gas`
      const cost = tx.gasLimit.mul((tx as FeeMarketEIP1559Transaction).maxFeePerGas).add(tx.value);
      if (balance.lt(cost)) {
        throw new Error(`sender doesn't have enough funds to send tx. The max cost is: ${cost} and the sender's account only has: ${balance}`);
      }
    }
  }
  if (!opts.skipNonce) {
    if (!nonce.eq(tx.nonce)) {
      throw new Error(`the tx doesn't have the correct nonce. account has nonce of: ${nonce} tx has nonce of: ${tx.nonce}`);
    }
  }

  let gasPrice;
  let inclusionFeePerGas;
  // EIP-1559 tx
  if (tx.supports(Capability.EIP1559FeeMarket)) {
    const baseFee = block.header.baseFeePerGas!;
    inclusionFeePerGas = BN.min((tx as FeeMarketEIP1559Transaction).maxPriorityFeePerGas, (tx as FeeMarketEIP1559Transaction).maxFeePerGas.sub(baseFee));
    gasPrice = inclusionFeePerGas.add(baseFee);
  } else {
    // Have to cast as legacy tx since EIP1559 tx does not have gas price
    gasPrice = (<Transaction>tx).gasPrice;
    if (this._common.isActivatedEIP(1559)) {
      const baseFee = block.header.baseFeePerGas!;
      inclusionFeePerGas = (<Transaction>tx).gasPrice.sub(baseFee);
    }
  }

  const txCost = tx.gasLimit.mul(gasPrice);
  if (opts.beforeTx) {
    await opts.beforeTx(state, tx, txCost);
  } else {
    // Update from account's nonce and balance
    fromAccount.nonce.iaddn(1);
    fromAccount.balance.isub(txCost);
    await state.putAccount(caller, fromAccount);
    if (this.DEBUG) {
      debug(`Update fromAccount (caller) nonce (-> ${fromAccount.nonce}) and balance(-> ${fromAccount.balance})`);
    }
  }

  // calculate block miner address
  let author: Address | undefined = undefined;
  if (this._getMiner) {
    author = this._getMiner(block.header);
  }

  /*
   * Execute message
   */
  const txContext = new TxContext(gasPrice, caller, author, accessList, blockGasUsed, recentHashes);
  const { value, data, to } = tx;
  const message = new Message({
    caller,
    gasLimit,
    to,
    value,
    data,
    basefee: basefee.toString(),
    clearEmptyAccount: true
  });
  const evm = new EVM(this, txContext, block, debugContext);
  if (this.DEBUG) {
    debug(`Running tx=0x${tx.isSigned() ? tx.hash().toString('hex') : 'unsigned'} with caller=${caller.toString()} gasLimit=${gasLimit} to=${to ? to.toString() : ''} value=${value} data=0x${short(data)}`);
  }

  const results = (await evm.executeMessage(message)) as RunTxResult;
  if (this.DEBUG) {
    debug('-'.repeat(100));
    debug(`Received tx results gasUsed=${results.gasUsed} execResult: [ gasUsed=${results.gasUsed} exceptionError=${results.execResult.exceptionError ? results.execResult.exceptionError.error : ''} returnValue=${short(results.execResult.returnValue)} gasRefund=${results.execResult.gasRefund} ]`);
  }

  /*
   * Parse results
   */
  // Generate the bloom for the tx
  results.bloom = txLogsBloom(results.execResult.logs);
  if (this.DEBUG) {
    debug(`Generated tx bloom with logs=${results.execResult.logs?.length}`);
  }

  // Caculate the total gas used
  results.gasUsed.iadd(basefee);
  if (this.DEBUG) {
    debugGas(`tx add baseFee ${basefee} to gasUsed (-> ${results.gasUsed})`);
  }

  // Process any gas refund
  let gasRefund = results.execResult.gasRefund ?? new BN(0);
  const maxRefundQuotient = this._common.param('gasConfig', 'maxRefundQuotient');
  if (!gasRefund.isZero()) {
    const maxRefund = results.gasUsed.divn(maxRefundQuotient);
    gasRefund = BN.min(gasRefund, maxRefund);
    results.gasUsed.isub(gasRefund);
    if (this.DEBUG) {
      debug(`Subtract tx gasRefund (${gasRefund}) from gasUsed (-> ${results.gasUsed})`);
    }
  } else {
    if (this.DEBUG) {
      debug('No tx gasRefund');
    }
  }
  results.amountSpent = results.gasUsed.mul(gasPrice);

  const actualTxCost = results.gasUsed.mul(gasPrice);
  if (opts.afterTx) {
    await opts.afterTx(state, tx, actualTxCost);
  } else {
    // Update sender's balance
    fromAccount = await state.getAccount(caller);
    const txCostDiff = txCost.sub(actualTxCost);
    fromAccount.balance.iadd(txCostDiff);
    await state.putAccount(caller, fromAccount);
    if (this.DEBUG) {
      debug(`Refunded txCostDiff (${txCostDiff}) to fromAccount (caller) balance (-> ${fromAccount.balance})`);
    }
  }

  const reward = this._common.isActivatedEIP(1559) ? results.gasUsed.mul(<BN>inclusionFeePerGas) : results.amountSpent;
  if (opts.assignTxReward) {
    await opts.assignTxReward(state, reward);
  } else {
    // Update miner's balance
    let miner;
    if (this._common.consensusType() === ConsensusType.ProofOfWork) {
      miner = block.header.coinbase;
    } else {
      if (this._getMiner) {
        miner = this._getMiner(block.header);
      } else {
        // Backwards-compatibilty check
        // TODO: can be removed along VM v6 release
        if ('cliqueSigner' in block.header) {
          miner = block.header.cliqueSigner();
        } else {
          miner = Address.zero();
        }
      }
    }
    const minerAccount = await state.getAccount(miner);
    // add the amount spent on gas to the miner's account
    minerAccount.balance.iadd(reward);

    // Put the miner account into the state. If the balance of the miner account remains zero, note that
    // the state.putAccount function puts this into the "touched" accounts. This will thus be removed when
    // we clean the touched accounts below in case we are in a fork >= SpuriousDragon
    await state.putAccount(miner, minerAccount);
    if (this.DEBUG) {
      debug(`tx update miner account (${miner.toString()}) balance (-> ${minerAccount.balance})`);
    }
  }

  /*
   * Cleanup accounts
   */
  if (results.execResult.selfdestruct) {
    const keys = Object.keys(results.execResult.selfdestruct);
    for (const k of keys) {
      const address = new Address(Buffer.from(k, 'hex'));
      await state.deleteAccount(address);
      if (this.DEBUG) {
        debug(`tx selfdestruct on address=${address.toString()}`);
      }
    }
  }
  await state.cleanupTouchedAccounts();
  state.clearOriginalStorageCache();

  // Generate the tx receipt
  const cumulativeGasUsed = (opts.blockGasUsed ?? block.header.gasUsed).add(results.gasUsed);
  results.receipt = await (opts.generateTxReceipt ?? generateTxReceipt).bind(this)(tx, results, cumulativeGasUsed);

  /**
   * The `afterTx` event
   *
   * @event Event: afterTx
   * @type {Object}
   * @property {Object} result result of the transaction
   */
  const event: AfterTxEvent = { transaction: tx, ...results };
  await this._emit('afterTx', event);
  if (this.DEBUG) {
    debug(`tx run finished hash=${opts.tx.isSigned() ? opts.tx.hash().toString('hex') : 'unsigned'} sender=${caller.toString()}`);
  }

  return results;
}

/**
 * @method txLogsBloom
 * @private
 */
function txLogsBloom(logs?: any[]): Bloom {
  const bloom = new Bloom();
  if (logs) {
    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      // add the address
      bloom.add(log[0]);
      // add the topics
      const topics = log[1];
      for (let q = 0; q < topics.length; q++) {
        bloom.add(topics[q]);
      }
    }
  }
  return bloom;
}

/**
 * Returns the tx receipt.
 * @param this The vm instance
 * @param tx The transaction
 * @param txResult The tx result
 * @param cumulativeGasUsed The gas used in the block including this tx
 */
export async function generateTxReceipt(this: VM, tx: TypedTransaction, txResult: RunTxResult, cumulativeGasUsed: BN): Promise<TxReceipt> {
  const baseReceipt: BaseTxReceipt = {
    gasUsed: cumulativeGasUsed.toArrayLike(Buffer),
    bitvector: txResult.bloom.bitvector,
    logs: txResult.execResult.logs ?? []
  };

  let receipt;
  if (this.DEBUG) {
    debug(`Generate tx receipt transactionType=${tx.type} gasUsed=${cumulativeGasUsed.toString()} bitvector=${short(baseReceipt.bitvector)} (${baseReceipt.bitvector.length} bytes) logs=${baseReceipt.logs.length}`);
  }

  if (!tx.supports(Capability.EIP2718TypedTransaction)) {
    // Legacy transaction
    if (this._common.gteHardfork('byzantium')) {
      // Post-Byzantium
      receipt = {
        status: txResult.execResult.exceptionError ? 0 : 1, // Receipts have a 0 as status on error
        ...baseReceipt
      } as PostByzantiumTxReceipt;
    } else {
      // Pre-Byzantium
      const stateRoot = await this.stateManager.getStateRoot(true);
      receipt = {
        stateRoot: stateRoot,
        ...baseReceipt
      } as PreByzantiumTxReceipt;
    }
  } else {
    // Typed EIP-2718 Transaction
    receipt = {
      status: txResult.execResult.exceptionError ? 0 : 1,
      ...baseReceipt
    } as PostByzantiumTxReceipt;
  }

  return receipt;
}
