import { Address, BN, toBuffer } from 'ethereumjs-util';
import { BaseTrie } from '@rei-network/trie';
import { VM } from '@rei-network/vm';
import EVM from '@rei-network/vm/dist/evm/evm';
import TxContext from '@rei-network/vm/dist/evm/txContext';
import { RunBlockOpts, rewardAccount, encodeReceipt } from '@rei-network/vm/dist/runBlock';
import { TxReceipt } from '@rei-network/vm/dist/types';
import { StateManager as IStateManager } from '@rei-network/vm/dist/state';
import { Block, TypedTransaction } from '@rei-network/structure';
import { logger } from '@rei-network/utils';
import { FinalizeOpts, ProcessBlockOpts, ProcessTxOpts, ExecutorBackend, Executor } from '../types';
import { Contract } from '../reimint/contracts';
import { ValidatorSet } from '../reimint/validatorSet';
import { isEnableRemint } from '../../hardforks';
import { postByzantiumTxReceiptsToReceipts, EMPTY_ADDRESS } from '../../utils';
import { Clique } from './clique';

export class CliqueExecutor implements Executor {
  private readonly backend: ExecutorBackend;

  constructor(backend: ExecutorBackend) {
    this.backend = backend;
  }

  /**
   * Assign block reward to miner
   * @param state - State manager instance
   * @param miner - Miner address
   * @param reward - Block rward
   */
  async assignBlockReward(state: IStateManager, miner: Address, reward: BN) {
    await rewardAccount(state, miner, reward);
  }

  /**
   * After block apply logic,
   * if the next block is in Reimint consensus,
   * we should deploy all system contracts
   * @param vm - VM instance
   * @param pendingBlock - Pending block
   * @returns Genesis validator set
   *          (if the next block is in Reimint consensus)
   */
  async afterApply(vm: VM, pendingBlock: Block) {
    let validatorSet: ValidatorSet | undefined;
    const nextCommon = this.backend.getCommon(pendingBlock.header.number.addn(1));
    if (isEnableRemint(nextCommon)) {
      // deploy system contracts
      const evm = new EVM(vm, new TxContext(new BN(0), EMPTY_ADDRESS), pendingBlock);
      await Contract.deployReimintContracts(evm, nextCommon);

      // create genesis validator set
      validatorSet = ValidatorSet.genesis(nextCommon);
    }

    return validatorSet;
  }

  /**
   * {@link Executor.finalize}
   */
  async finalize(options: FinalizeOpts) {
    const { block, stateRoot } = options;

    const pendingCommon = block._common;
    const vm = await this.backend.getVM(stateRoot, pendingCommon, true);

    const miner = Clique.getMiner(block);
    const minerReward = new BN(pendingCommon.param('pow', 'minerReward'));

    await vm.stateManager.checkpoint();
    try {
      await this.assignBlockReward(vm.stateManager, miner, minerReward);
      const validatorSet = await this.afterApply(vm, block);
      await vm.stateManager.commit();
      const finalizedStateRoot = await vm.stateManager.getStateRoot();
      return {
        finalizedStateRoot,
        validatorSet
      };
    } catch (err) {
      await vm.stateManager.revert();
      throw err;
    }
  }

  /**
   * {@link Executor.processBlock}
   */
  async processBlock(options: ProcessBlockOpts) {
    const { block, debug, force, skipConsensusValidation } = options;

    const miner = Clique.getMiner(block);
    const pendingHeader = block.header;
    const pendingCommon = block._common;

    if (!force) {
      // ensure that the block has not been committed
      try {
        const hashInDB = await this.backend.db.numberToHash(pendingHeader.number);
        if (hashInDB.equals(block.hash())) {
          throw new Error('committed');
        }
      } catch (err: any) {
        if (err.type !== 'NotFoundError') {
          throw err;
        }
      }
    }

    // get parent header from database
    const parent = await this.backend.db.getHeader(block.header.parentHash, pendingHeader.number.subn(1));

    // get state root and vm instance
    const root = parent.stateRoot;
    const vm = await this.backend.getVM(root, pendingCommon, true);

    if (!skipConsensusValidation) {
      Clique.consensusValidateHeader(pendingHeader, this.backend.blockchain);
    }

    let validatorSet: ValidatorSet | undefined;
    const runBlockOptions: RunBlockOpts = {
      block,
      root,
      debug,
      generate: false,
      skipBlockValidation: true,
      genReceiptTrie: async function (transactions: TypedTransaction[], receipts: TxReceipt[]) {
        const trie = new BaseTrie();
        for (let i = 0; i < receipts.length; i++) {
          await trie.put(toBuffer(i), encodeReceipt(transactions[i], receipts[i]));
        }
        return trie.root;
      },
      assignBlockReward: (state: IStateManager, reward: BN) => {
        return this.assignBlockReward(state, miner, reward);
      },
      afterApply: async () => {
        validatorSet = await this.afterApply(vm, block);
      }
    };

    const result = await vm.runBlock(runBlockOptions);

    if (validatorSet) {
      const activeValidators = validatorSet.active.activeValidators();
      logger.debug(
        'Clique::processBlock, activeValidators:',
        activeValidators.map(({ validator, priority }) => {
          return `address: ${validator.toString()} | priority: ${priority.toString()} | votingPower: ${validatorSet!.indexed.getVotingPower(validator).toString()}`;
        }),
        'next proposer:',
        validatorSet.active.proposer.toString()
      );
    }
    return { receipts: postByzantiumTxReceiptsToReceipts(result.receipts), validatorSet };
  }

  /**
   * {@link Executor.processTx}
   */
  async processTx(options: ProcessTxOpts) {
    const { root } = options;
    const vm = await this.backend.getVM(root, options.block._common, true);
    const result = await vm.runTx(options);
    return {
      receipt: postByzantiumTxReceiptsToReceipts([result.receipt])[0],
      gasUsed: result.gasUsed,
      bloom: result.bloom,
      root: await vm.stateManager.getStateRoot()
    };
  }
}
