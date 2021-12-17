import { Address, BN, bufferToHex } from 'ethereumjs-util';
import { logger } from '@rei-network/utils';
import { Block, Log, Receipt } from '@rei-network/structure';
import { RunBlockOpts, rewardAccount } from '@gxchain2-ethereumjs/vm/dist/runBlock';
import { StateManager as IStateManager } from '@gxchain2-ethereumjs/vm/dist/state';
import VM from '@gxchain2-ethereumjs/vm';
import { ExecutorBackend, FinalizeOpts, ProcessBlockOpts, ProcessTxOpts, Executor } from '../types';
import { postByzantiumTxReceiptsToReceipts } from '../../utils';
import { ValidatorSet, ValidatorChanges } from '../../staking';
import { StakeManager, SlashReason } from '../../contracts';
import { Reimint } from './reimint';
import { EvidencePool, Evidence, DuplicateVoteEvidence } from './evpool';
import { ExtraData } from './extraData';

export class ReimintExecutor implements Executor {
  private readonly backend: ExecutorBackend;
  private readonly evpool: EvidencePool;

  constructor(backend: ExecutorBackend, evpool: EvidencePool) {
    this.backend = backend;
    this.evpool = evpool;
  }

  /**
   * Assign block reward to miner,
   * in Reimint consensus,
   * it will first assign all block rewards to the system caller,
   * then the system caller will call `Router.assignBlockReward`
   * to assign block reward to real miner
   * @param state - State manger instance
   * @param systemCaller - System caller address
   * @param reward - Block reward
   */
  async assignBlockReward(state: IStateManager, systemCaller: Address, reward: BN) {
    // if staking is active, assign reward to system caller address
    await rewardAccount(state, systemCaller, reward);
  }

  /**
   * After apply block logic,
   * 1. call `Router.assignBlockReward`
   * 2. call `Router.slash` (if evidence exists)
   * 3. collect all transaction logs
   * 4. merge validator changes to parent validator set
   * 5. call `Router.onAfterBlock`
   * @param vm - VM instance
   * @param pendingBlock - Pending block
   * @param receipts - Transaction receipts
   * @param miner - Miner address
   * @param blockReward - Block reward
   * @param parentValidatorSet - Validator set loaded from parent state trie
   * @param parentStakeManager - Stake manager contract instance
   *                             (used to load totalLockedAmount and validatorCount and validatorSet if need)
   * @param parentRouter - Router contract instance
   *                       (used to call `Router.assignBlockReward` and `Router.onAfterBlock`)
   * @returns New validator set
   */
  async afterApply(vm: VM, pendingBlock: Block, receipts: Receipt[], evidence: Evidence[], miner: Address, blockReward: BN, parentValidatorSet: ValidatorSet, parentStakeManager: StakeManager) {
    const pendingCommon = pendingBlock._common;

    let logs: Log[] = [];
    const ethLogs = await parentStakeManager.reward(miner, blockReward);
    if (ethLogs && ethLogs.length > 0) {
      logs = logs.concat(ethLogs.map((raw) => Log.fromValuesArray(raw)));
    }

    for (const ev of evidence) {
      if (ev instanceof DuplicateVoteEvidence) {
        const { voteA, voteB } = ev;
        logger.debug('Reimint::afterApply, find evidence(h,r,v,ha,hb):', voteA.height.toString(), voteA.round, voteA.validator().toString(), bufferToHex(voteA.hash), bufferToHex(voteB.hash));

        const ethLogs = await parentStakeManager.slash(ev.voteA.validator(), SlashReason.DuplicateVote);
        if (ethLogs && ethLogs.length > 0) {
          logs = logs.concat(ethLogs.map((raw) => Log.fromValuesArray(raw)));
        }
      } else {
        throw new Error('unknown evidence');
      }
    }

    const { totalLockedAmount, validatorCount } = await parentStakeManager.getTotalLockedAmountAndValidatorCount();
    logger.debug('Reimint::afterApply, totalLockedAmount:', totalLockedAmount.toString(), 'validatorCount:', validatorCount.toString());
    const enableGenesisValidators = Reimint.isEnableGenesisValidators(totalLockedAmount, validatorCount.toNumber(), pendingCommon);

    let validatorSet: ValidatorSet;
    if (enableGenesisValidators) {
      if (!parentValidatorSet.isGenesisValidatorSet()) {
        logger.debug('Reimint::afterApply, EnableGenesisValidators, create a new genesis validator set');
        // if the parent validator set isn't a genesis validator set, we create a new one
        validatorSet = ValidatorSet.createGenesisValidatorSet(pendingCommon);
      } else {
        logger.debug('Reimint::afterApply, EnableGenesisValidators, copy from parent');
        // if the parent validator set is a genesis validator set, we copy the set from the parent
        validatorSet = parentValidatorSet.copy();
      }
    } else {
      if (parentValidatorSet.isGenesisValidatorSet()) {
        logger.debug('Reimint::afterApply, DisableGenesisValidators, create a new normal validator set');
        // if the parent validator set is a genesis validator set, we create a new set from state trie
        validatorSet = await ValidatorSet.createFromStakeManager(parentStakeManager, true);
      } else {
        logger.debug('Reimint::afterApply, DisableGenesisValidators, copy from parent and merge changes');
        // filter changes
        const changes = new ValidatorChanges(parentValidatorSet);
        StakeManager.filterReceiptsChanges(changes, receipts, pendingCommon);
        if (logs) {
          StakeManager.filterLogsChanges(changes, logs, pendingCommon);
        }
        for (const uv of changes.unindexedValidators) {
          logger.debug('Reimint::processBlock, unindexedValidators, address:', uv.toString());
        }
        for (const vc of changes.changes.values()) {
          logger.debug('Reimint::processBlock, change, address:', vc.validator.toString(), 'votingPower:', vc.votingPower?.toString(), 'update:', vc.update.toString());
        }

        // copy from parent
        validatorSet = parentValidatorSet!.copy();
        // merge changes
        validatorSet.mergeChanges(changes);
      }
    }

    // increase once
    validatorSet.incrementProposerPriority(1);

    const activeValidators = validatorSet.activeValidators();
    if (activeValidators.length === 0) {
      throw new Error('activeValidators length is zero');
    }

    const activeSigners = activeValidators.map(({ validator }) => validator);
    const priorities = activeValidators.map(({ priority }) => priority);
    // call after block callback to save active validators list
    await parentStakeManager.onAfterBlock(validatorSet.proposer, activeSigners, priorities);
    return validatorSet;
  }

  /**
   * {@link ConsensusEngine.finalize}
   */
  async finalize(options: FinalizeOpts) {
    const { block, receipts, stateRoot, parentStateRoot, round, evidence } = options;
    if (round === undefined || evidence === undefined || !parentStateRoot) {
      throw new Error('missing state root or round or evidence');
    }

    const pendingCommon = block._common;
    const vm = await this.backend.getVM(stateRoot, pendingCommon);

    const miner = Reimint.getMiner(block);
    const minerReward = new BN(pendingCommon.param('pow', 'minerReward'));
    const systemCaller = Address.fromString(pendingCommon.param('vm', 'scaddr'));
    const parentStakeManager = this.backend.getStakeManager(vm, block);
    const parentValidatorSet = (await this.backend.validatorSets.get(parentStateRoot, parentStakeManager)).copy();
    parentValidatorSet.incrementProposerPriority(round);

    await vm.stateManager.checkpoint();
    try {
      await this.assignBlockReward(vm.stateManager, systemCaller, minerReward);
      const validatorSet = await this.afterApply(vm, block, receipts, evidence, miner, minerReward, parentValidatorSet, parentStakeManager);
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
   * {@link ConsensusEngine.processBlock}
   */
  async processBlock(options: ProcessBlockOpts) {
    const { debug, block, skipConsensusValidation, skipConsensusVerify } = options;

    const pendingHeader = block.header;
    const pendingCommon = block._common;

    // get parent block from database
    const parent = await this.backend.db.getBlockByHashAndNumber(block.header.parentHash, pendingHeader.number.subn(1));

    // get state root and vm instance
    const root = parent.header.stateRoot;
    const vm = await this.backend.getVM(root, pendingCommon);

    const systemCaller = Address.fromString(pendingCommon.param('vm', 'scaddr'));
    const parentStakeManager = this.backend.getStakeManager(vm, block);
    let parentValidatorSet = await this.backend.validatorSets.get(root, parentStakeManager);

    const extraData = ExtraData.fromBlockHeader(pendingHeader, { valSet: parentValidatorSet });
    const miner = extraData.proposal.proposer();

    // now, parentValidatorSet has increased extraData.proposal.round times
    parentValidatorSet = extraData.validatorSet()!;

    if (!skipConsensusValidation) {
      extraData.validate();
    }

    if (!skipConsensusVerify) {
      await extraData.verifyEvidence(this.backend);
      await this.evpool.checkEvidence(extraData.evidence);
    }

    let validatorSet!: ValidatorSet;
    const blockReward = new BN(0);
    const runBlockOptions: RunBlockOpts = {
      block,
      root,
      debug,
      generate: false,
      skipBlockValidation: true,
      assignBlockReward: async (state: IStateManager, reward: BN) => {
        await this.assignBlockReward(state, systemCaller, reward);
        blockReward.iadd(reward);
      },
      afterApply: async (state, { receipts: postByzantiumTxReceipts }) => {
        const receipts = postByzantiumTxReceiptsToReceipts(postByzantiumTxReceipts);
        validatorSet = await this.afterApply(vm, block, receipts, extraData.evidence, miner, blockReward, parentValidatorSet, parentStakeManager);
      }
    };

    const result = await vm.runBlock(runBlockOptions);

    const activeValidators = validatorSet.activeValidators();
    logger.debug(
      'Reimint::processBlock, activeValidators:',
      activeValidators.map(({ validator, priority }) => {
        return `address: ${validator.toString()} | priority: ${priority.toString()} | votingPower: ${validatorSet!.getVotingPower(validator).toString()}`;
      }),
      'next proposer:',
      validatorSet.proposer.toString()
    );
    return { receipts: postByzantiumTxReceiptsToReceipts(result.receipts), validatorSet };
  }

  /**
   * {@link ConsensusEngine.processTx}
   */
  async processTx(options: ProcessTxOpts) {
    const { root, block, tx, blockGasUsed } = options;
    const vm = await this.backend.getVM(root, block._common);
    const result = await vm.runTx({
      tx,
      block,
      blockGasUsed
    });
    return {
      receipt: postByzantiumTxReceiptsToReceipts([result.receipt])[0],
      gasUsed: result.gasUsed,
      bloom: result.bloom,
      root: await vm.stateManager.getStateRoot()
    };
  }
}
