import { BaseTrie as Trie } from 'merkle-patricia-tree';
import { Address, BN, toBuffer } from 'ethereumjs-util';
import { Block } from '@gxchain2/block';
import { Receipt, Log } from '@gxchain2/receipt';
import VM from '@ethereumjs/vm';
import Bloom from '@ethereumjs/vm/dist/bloom';
import { RunTxResult } from '@ethereumjs/vm/dist/runTx';
import { StateManager } from '@ethereumjs/vm/dist/state';
import { RunBlockOpts } from '@ethereumjs/vm/dist/runBlock';
import { VmError } from '@ethereumjs/vm/dist/exceptions';
import { InterpreterStep } from '@ethereumjs/vm/dist/evm/interpreter';
import { DebugOpts } from './types';

type PromisResultType<T> = T extends PromiseLike<infer U> ? U : T;

/**
 * Options for running a block.
 */
export interface RunBlockDebugOpts extends RunBlockOpts {
  /**
   * Debug callback
   */
  debug?: DebugOpts;
}

/**
 * Result of [[runBlock]]
 */
export interface RunBlockResult {
  result: PromisResultType<ReturnType<typeof applyBlock>>;
  block?: Block;
}

export interface AfterBlockEvent extends RunBlockResult {
  // The block which just finished processing
  block: Block;
}

/**
 * @ignore
 */
export default async function runBlock(this: VM, opts: RunBlockDebugOpts): Promise<{ result: PromisResultType<ReturnType<typeof applyBlock>>; block?: Block }> {
  const state = this.stateManager;
  const { root } = opts;
  let block = opts.block;
  const generateStateRoot = !!opts.generate;

  /**
   * The `beforeBlock` event.
   *
   * @event Event: beforeBlock
   * @type {Object}
   * @property {Block} block emits the block that is about to be processed
   */
  await this._emit('beforeBlock', block);

  if (this._selectHardforkByBlockNumber) {
    const currentHf = this._common.hardfork();
    this._common.setHardforkByBlockNumber(block.header.number.toNumber());
    if (this._common.hardfork() != currentHf) {
      this._updateOpcodes();
    }
  }

  // Set state root if provided
  if (root) {
    await state.setStateRoot(root);
  }

  // Checkpoint state
  await state.checkpoint();
  let result: PromisResultType<ReturnType<typeof applyBlock>>;
  try {
    result = await applyBlock.bind(this)(block, opts);
  } catch (err) {
    await state.revert();
    throw err;
  }

  // Persist state
  await state.commit();
  const stateRoot = await state.getStateRoot(false);

  // Given the generate option, either set resulting header
  // values to the current block, or validate the resulting
  // header values against the current block.
  if (generateStateRoot) {
    block = Block.fromBlockData(
      {
        ...block,
        header: {
          ...block.header,
          stateRoot,
          receiptTrie: result.receiptRoot,
          gasUsed: result.gasUsed,
          bloom: result.bloom.bitvector
        }
      },
      { common: this._common }
    );
  } else {
    if (result.receiptRoot && !result.receiptRoot.equals(block.header.receiptTrie)) {
      throw new Error('invalid receiptTrie');
    }
    if (!result.bloom.bitvector.equals(block.header.bloom)) {
      throw new Error('invalid bloom');
    }
    if (!result.gasUsed.eq(block.header.gasUsed)) {
      throw new Error('invalid gasUsed');
    }
    if (!stateRoot.equals(block.header.stateRoot)) {
      throw new Error('invalid block stateRoot');
    }
  }

  const { receipts, results } = result;

  /**
   * The `afterBlock` event
   *
   * @event Event: afterBlock
   * @type {Object}
   * @property {Object} result emits the results of processing a block
   */
  await this._emit('afterBlock', { receipts, results });

  return generateStateRoot ? { result, block } : { result };
}

/**
 * Validates and applies a block, computing the results of
 * applying its transactions. This method doesn't modify the
 * block itself. It computes the block rewards and puts
 * them on state (but doesn't persist the changes).
 * @param {Block} block
 * @param {RunBlockOpts} opts
 */
async function applyBlock(this: VM, block: Block, opts: RunBlockDebugOpts) {
  // Validate block
  if (!opts.skipBlockValidation) {
    if (block.header.gasLimit.gte(new BN('8000000000000000', 16))) {
      throw new Error('Invalid block with gas limit greater than (2^63 - 1)');
    } else {
      await block.validate(this.blockchain);
    }
  }
  // Apply transactions
  const txResults = await applyTransactions.bind(this)(block, opts);
  // Pay ommers and miners
  await assignBlockRewards.bind(this)(block);
  return txResults;
}

/**
 * Applies the transactions in a block, computing the receipts
 * as well as gas usage and some relevant data. This method is
 * side-effect free (it doesn't modify the block nor the state).
 * @param {Block} block
 * @param {RunBlockOpts} opts
 */
async function applyTransactions(this: VM, block: Block, opts: RunBlockDebugOpts) {
  const bloom = new Bloom();
  // the total amount of gas used processing these transactions
  let gasUsed = new BN(0);
  const receiptTrie = new Trie();
  const receipts: Receipt[] = [];
  const txResults: RunTxResult[] = [];
  const errors: (VmError | undefined)[] = [];

  let lastStep: undefined | InterpreterStep;
  let handler: undefined | ((step: InterpreterStep, next: () => void) => void);
  if (opts.debug) {
    handler = (step: InterpreterStep, next: () => void) => {
      if (lastStep !== undefined) {
        opts.debug!.captureState(lastStep);
      }
      lastStep = step;
      next();
    };
    this.on('step', handler);
  }

  /*
   * Process transactions
   */
  let catchedErr: any;
  for (let txIdx = 0; txIdx < block.transactions.length; txIdx++) {
    const tx = block.transactions[txIdx];

    // Call tx exec start
    let time: undefined | number;
    if (opts.debug && (!opts.debug.hash || opts.debug.hash.equals(tx.hash()))) {
      time = Date.now();
      opts.debug.captureStart(tx.getSenderAddress(), tx.toCreationAddress(), tx.data, tx.gasLimit, tx.value, tx.to);
    }

    let txRes: undefined | RunTxResult;
    try {
      const gasLimitIsHigherThanBlock = block.header.gasLimit.lt(tx.gasLimit.add(gasUsed));
      if (gasLimitIsHigherThanBlock) {
        throw new Error('tx has a higher gas limit than the block');
      }

      // Run the tx through the VM
      const { skipBalance, skipNonce } = opts;
      txRes = await this.runTx({
        tx,
        block,
        skipBalance,
        skipNonce
      });
      txResults.push(txRes);
    } catch (err) {
      catchedErr = err;
    }

    if (txRes) {
      // Add to total block gas usage
      gasUsed = gasUsed.add(txRes.gasUsed);
      // Combine blooms via bitwise OR
      bloom.or(txRes.bloom);

      const txReceipt = new Receipt(txRes.gasUsed.toArrayLike(Buffer), txRes.bloom.bitvector, txRes.execResult?.logs?.map((log) => Log.fromValuesArray(log)) || [], txRes.execResult.exceptionError ? 0 : 1);
      receipts.push(txReceipt);

      // Save the vm error
      errors.push(txRes.execResult.exceptionError);

      // Add receipt to trie to later calculate receipt root
      await receiptTrie.put(toBuffer(txIdx), txReceipt.serialize());
    }

    // Call tx exec over
    if (opts.debug && (!opts.debug.hash || opts.debug.hash.equals(tx.hash()))) {
      // lastStep logically must exist here
      if (txRes?.execResult.exceptionError) {
        opts.debug.captureFault(lastStep!, txRes.execResult.exceptionError);
      } else if (catchedErr !== undefined) {
        opts.debug.captureFault(lastStep!, catchedErr);
      } else {
        opts.debug.captureState(lastStep!);
      }
      if (txRes) {
        opts.debug.captureEnd(txRes.execResult.returnValue, txRes.gasUsed, Date.now() - time!);
      } else {
        opts.debug.captureEnd(Buffer.alloc(0), new BN(0), Date.now() - time!);
      }
    }
    if (lastStep !== undefined) {
      lastStep = undefined;
    }

    if (catchedErr) {
      break;
    }
  }

  if (handler) {
    this.removeListener('step', handler);
  }

  if (catchedErr) {
    throw catchedErr;
  }

  return {
    bloom,
    gasUsed,
    receiptRoot: receiptTrie.root,
    receipts,
    errors,
    results: txResults
  };
}

/**
 * Calculates block rewards for miner and ommers and puts
 * the updated balances of their accounts to state.
 */
async function assignBlockRewards(this: VM, block: Block): Promise<void> {
  const state = this.stateManager;
  const minerReward = new BN(this._common.param('pow', 'minerReward'));
  const ommers = block.uncleHeaders;
  // Reward ommers
  for (const ommer of ommers) {
    const reward = calculateOmmerReward(ommer.number, block.header.number, minerReward);
    await rewardAccount(state, ommer.coinbase, reward);
  }
  // Reward miner
  const reward = calculateMinerReward(minerReward, ommers.length);
  await rewardAccount(state, block.header.coinbase, reward);
}

function calculateOmmerReward(ommerBlockNumber: BN, blockNumber: BN, minerReward: BN): BN {
  const heightDiff = blockNumber.sub(ommerBlockNumber);
  let reward = new BN(8).sub(heightDiff).mul(minerReward.divn(8));
  if (reward.ltn(0)) {
    reward = new BN(0);
  }
  return reward;
}

function calculateMinerReward(minerReward: BN, ommersNum: number): BN {
  // calculate nibling reward
  const niblingReward = minerReward.divn(32);
  const totalNiblingReward = niblingReward.muln(ommersNum);
  const reward = minerReward.add(totalNiblingReward);
  return reward;
}

async function rewardAccount(state: StateManager, address: Address, reward: BN): Promise<void> {
  const account = await state.getAccount(address);
  account.balance.iadd(reward);
  await state.putAccount(address, account);
}
