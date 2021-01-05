import EthereumJSVM from '@ethereumjs/vm';
import { BaseTrie as Trie } from 'merkle-patricia-tree';
import { toBuffer, Address, BN } from 'ethereumjs-util';
import { Block } from '@ethereumjs/block';
import Blockchain from '@ethereumjs/blockchain';
import type { RunBlockOpts } from '@ethereumjs/vm/dist/runBlock';
import type { RunTxResult } from '@ethereumjs/vm/dist/runTx';
import Bloom from '@ethereumjs/vm/dist/bloom';
import { StateManager } from '@ethereumjs/vm/dist/state/interface';

import { Receipt } from './receipt';

class VM extends EthereumJSVM {
  async runOrGenerateBlockchain(blockchain?: Blockchain): Promise<void> {
    await this.init();
    return runBlockchain.bind(this)(blockchain);
  }

  async runOrGenerateBlock(opts: RunBlockOpts): ReturnType<typeof runBlock> {
    await this.init();
    return runBlock.bind(this)(opts);
  }
}

export { VM };

type PromisResultType<T> = T extends PromiseLike<infer U> ? U : T;

/////////// runBlockchain ////////////

/**
 * @ignore
 */
async function runBlockchain(this: VM, blockchain?: Blockchain) {
  let headBlock: Block;
  let parentState: Buffer;

  blockchain = blockchain || this.blockchain;

  await blockchain.iterator('vm', async (block: Block, reorg: boolean) => {
    // determine starting state for block run
    // if we are just starting or if a chain re-org has happened
    if (!headBlock || reorg) {
      const parentBlock = await blockchain!.getBlock(block.header.parentHash);
      parentState = parentBlock.header.stateRoot;
      // generate genesis state if we are at the genesis block
      // we don't have the genesis state
      if (!headBlock) {
        // It has been manually generated.
        // await this.stateManager.generateCanonicalGenesis();
      } else {
        parentState = headBlock.header.stateRoot;
      }
    }

    // run block, update head if valid
    try {
      await this.runOrGenerateBlock({ block, root: parentState, skipBlockValidation: true, generate: true });
      // set as new head block
      headBlock = block;
    } catch (error) {
      // remove invalid block
      await blockchain!.delBlock(block.header.hash());
      throw error;
    }
  });
}

/////////// runBlockchain ////////////

/////////// runBlock ////////////

/**
 * @ignore
 */
async function runBlock(this: VM, opts: RunBlockOpts): Promise<{ result: PromisResultType<ReturnType<typeof applyBlock>>; block?: Block }> {
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
    block = Block.fromBlockData({
      ...block,
      header: {
        ...block.header,
        stateRoot,
        receiptTrie: result.receiptRoot,
        gasUsed: result.gasUsed,
        bloom: result.bloom.bitvector
      }
    });
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
async function applyBlock(this: VM, block: Block, opts: RunBlockOpts) {
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
async function applyTransactions(this: VM, block: Block, opts: RunBlockOpts) {
  const bloom = new Bloom();
  // the total amount of gas used processing these transactions
  let gasUsed = new BN(0);
  const receiptTrie = new Trie();
  const receipts: Receipt[] = [];
  const txResults: RunTxResult[] = [];

  /*
   * Process transactions
   */
  for (let txIdx = 0; txIdx < block.transactions.length; txIdx++) {
    const tx = block.transactions[txIdx];

    const gasLimitIsHigherThanBlock = block.header.gasLimit.lt(tx.gasLimit.add(gasUsed));
    if (gasLimitIsHigherThanBlock) {
      throw new Error('tx has a higher gas limit than the block');
    }

    // Run the tx through the VM
    const { skipBalance, skipNonce } = opts;
    const txRes = await this.runTx({
      tx,
      block,
      skipBalance,
      skipNonce
    });
    txResults.push(txRes);

    // Add to total block gas usage
    gasUsed = gasUsed.add(txRes.gasUsed);
    // Combine blooms via bitwise OR
    bloom.or(txRes.bloom);

    const txReceipt = new Receipt(gasUsed.toArrayLike(Buffer), txRes.bloom.bitvector, txRes.execResult.logs || [], txRes.execResult.exceptionError ? 0 : 1);
    receipts.push(txReceipt);

    // Add receipt to trie to later calculate receipt root
    await receiptTrie.put(toBuffer(txIdx), txReceipt.raw());
  }

  return {
    bloom,
    gasUsed,
    receiptRoot: receiptTrie.root,
    receipts,
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

/////////// runBlock ////////////
