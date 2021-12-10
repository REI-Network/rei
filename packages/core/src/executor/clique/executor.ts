import { Address, BN } from 'ethereumjs-util';
import VM from '@gxchain2-ethereumjs/vm';
import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import TxContext from '@gxchain2-ethereumjs/vm/dist/evm/txContext';
import { RunBlockOpts, rewardAccount } from '@gxchain2-ethereumjs/vm/dist/runBlock';
import { StateManager as IStateManager } from '@gxchain2-ethereumjs/vm/dist/state';
import { Block } from '@rei-network/structure';
import { logger } from '@rei-network/utils';
import { FinalizeOpts, ProcessBlockOpts, ProcessTxOptions, ExecutorBackend } from '../types';
import { Contract, Router } from '../../contracts';
import { ValidatorSet } from '../../staking';
import { isEnableStaking } from '../../hardforks';
import { postByzantiumTxReceiptsToReceipts, EMPTY_ADDRESS } from '../../utils';
import { Clique } from '../../consensus/clique/clique';

export class CliqueExecutor {
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
   * we should deploy all system contract and
   * call `Router.onAfterBlock`
   * @param vm - VM instance
   * @param pendingBlock - Pending block
   * @returns Genesis validator set
   *          (if the next block is in Reimint consensus)
   */
  async afterApply(vm: VM, pendingBlock: Block) {
    let validatorSet: ValidatorSet | undefined;
    const nextCommon = this.backend.getCommon(pendingBlock.header.number.addn(1));
    if (isEnableStaking(nextCommon)) {
      // deploy system contracts
      const evm = new EVM(vm, new TxContext(new BN(0), EMPTY_ADDRESS), pendingBlock);
      await Contract.deploy(evm, nextCommon);

      const parentRouter = new Router(evm, nextCommon);
      validatorSet = ValidatorSet.createGenesisValidatorSet(nextCommon);

      const activeValidators = validatorSet.activeValidators();
      if (activeValidators.length === 0) {
        throw new Error('activeValidators length is zero');
      }

      const activeSigners = activeValidators.map(({ validator }) => validator);
      const priorities = activeValidators.map(({ priority }) => priority);
      // call after block callback to save active validators list
      await parentRouter!.onAfterBlock(validatorSet.proposer, activeSigners, priorities);

      // start consensus engine
      //   this.node.getReimintEngine()?.start(); TODO: fix this!
    }

    return validatorSet;
  }

  /**
   * {@link ConsensusEngine.finalize}
   */
  async finalize(options: FinalizeOpts) {
    const { block, stateRoot, receipts, transactions } = options;

    const pendingCommon = block._common;
    const vm = await this.backend.getVM(stateRoot, pendingCommon);

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
        receiptTrie: await Clique.genReceiptTrie(transactions, receipts),
        validatorSet
      };
    } catch (err) {
      await vm.stateManager.revert();
      throw err;
    }
  }

  /**
   * {@link ConsensusEngine.processBlock}
   */
  async processBlock(options: ProcessBlockOpts) {
    const { block } = options;

    const miner = Clique.getMiner(block);
    const pendingHeader = block.header;
    const pendingCommon = block._common;

    // get parent header from database
    const parent = await this.backend.db.getHeader(block.header.parentHash, pendingHeader.number.subn(1));

    // get state root and vm instance
    const root = parent.stateRoot;
    const vm = await this.backend.getVM(root, pendingCommon);

    if (!options.skipConsensusValidation) {
      Clique.consensusValidateHeader(pendingHeader, this.backend.blockchain);
    }

    let validatorSet: ValidatorSet | undefined;
    const runBlockOptions: RunBlockOpts = {
      debug: options.debug,
      block,
      root,
      generate: false,
      skipBlockValidation: true,
      genReceiptTrie: Clique.genReceiptTrie,
      assignBlockReward: (state: IStateManager, reward: BN) => {
        return this.assignBlockReward(state, miner, reward);
      },
      afterApply: async () => {
        validatorSet = await this.afterApply(vm, block);
      }
    };

    const result = await vm.runBlock(runBlockOptions);

    if (validatorSet) {
      const activeValidators = validatorSet.activeValidators();
      logger.debug(
        'Clique::processBlock, activeValidators:',
        activeValidators.map(({ validator, priority }) => {
          return `address: ${validator.toString()} | priority: ${priority.toString()} | votingPower: ${validatorSet!.getVotingPower(validator).toString()}`;
        }),
        'next proposer:',
        validatorSet.proposer.toString()
      );
    }
    return { ...result, receipts: postByzantiumTxReceiptsToReceipts(result.receipts), validatorSet };
  }

  /**
   * {@link ConsensusEngine.processTx}
   */
  async processTx(options: ProcessTxOptions) {
    const { root } = options;
    const vm = await this.backend.getVM(root, options.block._common);
    return await vm.runTx(options);
  }
}
