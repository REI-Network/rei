import { Address, BN, bufferToHex } from 'ethereumjs-util';
import { logger } from '@rei-network/utils';
import { Block, Log, Receipt } from '@rei-network/structure';
import { RunBlockOpts, rewardAccount } from '@rei-network/vm/dist/runBlock';
import { StateManager as IStateManager } from '@rei-network/vm/dist/state';
import { RunTxResult } from '@rei-network/vm/dist/runTx';
import { VM } from '@rei-network/vm';
import EVM from '@rei-network/vm/dist/evm/evm';
import TxContext from '@rei-network/vm/dist/evm/txContext';
import { ExecutorBackend, FinalizeOpts, ProcessBlockOpts, ProcessTxOpts, Executor } from '../types';
import { postByzantiumTxReceiptsToReceipts, EMPTY_ADDRESS } from '../../utils';
import { isEnableFreeStaking, isEnableHardfork1, isEnableValidatorsIndex } from '../../hardforks';
import { StateManager } from '../../stateManager';
import { ValidatorSet, ValidatorChanges } from './validatorSet';
import { StakeManager, SlashReason, Fee, Contract } from './contracts';
import { Reimint } from './reimint';
import { Evidence, DuplicateVoteEvidence } from './evpool';
import { ExtraData } from './extraData';
import { ReimintConsensusEngine } from './engine';
import { makeRunTxCallback } from './makeRunTxCallback';

/**
 * Calculate accumulative fee usage
 * and accumulative balance usage from receipte
 * @param receipts - Receipts
 * @returns Fee and balance usage
 */
function calcAccUsage(receipts: Receipt[]) {
  const accFeeUsage = new BN(0);
  const accBalUsage = new BN(0);
  for (const receipt of receipts) {
    if (receipt.logs.length === 0) {
      throw new Error('invalid receipt, missing logs');
    }
    const log = receipt.logs[receipt.logs.length - 1];
    if (log.topics.length !== 3) {
      throw new Error('invalid log');
    }
    accFeeUsage.iadd(new BN(log.topics[1]));
    accBalUsage.iadd(new BN(log.topics[2]));
  }

  return {
    accFeeUsage,
    accBalUsage
  };
}

export class ReimintExecutor implements Executor {
  private readonly backend: ExecutorBackend;
  private readonly engine: ReimintConsensusEngine;

  constructor(backend: ExecutorBackend, engine: ReimintConsensusEngine) {
    this.backend = backend;
    this.engine = engine;
  }

  /**
   * Assign block reward to miner,
   * in Reimint consensus,
   * it will first assign all block rewards to the system caller,
   * then the system caller will call `StakeManager.reward`
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
   * After apply block logic
   * @param vm - VM instance
   * @param pendingBlock - Pending block
   * @param receipts - Transaction receipts
   * @param miner - Miner address
   * @param totalReward - Total block reward
   *                      totalReward = common.param('pow', 'minerRewardFactor') + accBalUsage + etc(if some one transfer REI to system caller address)
   * @param parentValidatorSet - Validator set loaded from parent state trie
   * @param parentStakeManager - Stake manager contract instance
   *                             (used to load totalLockedAmount and validatorCount and validatorSet if need)
   * @returns New validator set
   */
  async afterApply(vm: VM, pendingBlock: Block, receipts: Receipt[], evidence: Evidence[], miner: Address, totalReward: BN, parentValidatorSet: ValidatorSet, parentStakeManager: StakeManager) {
    const pendingCommon = pendingBlock._common;

    let accFeeUsage: BN | undefined;
    let accBalUsage: BN | undefined;

    // 1. calculate miner reward and fee pool reward
    let minerReward: BN;
    let feePoolReward: BN;
    if (isEnableFreeStaking(pendingCommon)) {
      const result = calcAccUsage(receipts);
      accFeeUsage = result.accFeeUsage;
      accBalUsage = result.accBalUsage;

      const totalBlockReward = totalReward.sub(accBalUsage);
      const minerFactor = pendingCommon.param('vm', 'minerRewardFactor');
      if (typeof minerFactor !== 'number' || minerFactor > 100 || minerFactor < 0) {
        throw new Error('invalid miner factor');
      }

      /**
       * If free staking is enable,
       * minerReward = (totalReward - accBalUsage) * common.param('vm', 'minerRewardFactor') / 100
       * feePoolReward = totalReward - minerReward
       */
      minerReward = totalBlockReward.muln(minerFactor).divn(100);
      feePoolReward = totalBlockReward.sub(minerReward);
    } else {
      /**
       * If free staking is disable,
       * minerReward = totalReward
       * feePoolReward = 0
       */
      minerReward = totalReward;
      feePoolReward = new BN(0);
    }

    // 2. call stakeManager.reward to assign miner reward
    let logs: Log[] = [];
    const ethLogs = await parentStakeManager.reward(miner, minerReward);
    if (ethLogs && ethLogs.length > 0) {
      logs = logs.concat(ethLogs.map((raw) => Log.fromValuesArray(raw)));
    }

    // 3. call stakeManager.slash to slash validators
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

    if (isEnableFreeStaking(pendingCommon)) {
      // 4. filter all receipts to collect free staking changes,
      //    then modify user accounts based on changes
      const changes = Fee.filterReceipts(receipts, pendingCommon);
      for (const [addr, value] of changes) {
        if (!value.isZero()) {
          const acc = await (vm.stateManager as StateManager).getAccount(addr);
          if (value.isNeg()) {
            acc.getStakeInfo().withdraw(value.neg());
          } else {
            acc.getStakeInfo().deposit(value);
          }
          await vm.stateManager.putAccount(addr, acc);
        }
      }

      // 5. calculate miner amount and distributed value,
      //    and call feePool.distribute
      const minerAmount = accBalUsage!.add(accFeeUsage!);
      const distributeValue = feePoolReward.add(accBalUsage!);
      const feePool = this.engine.getFeePool(vm, pendingBlock, pendingCommon);
      const ethLogs = await feePool!.distribute(miner, minerAmount, distributeValue);
      if (ethLogs && ethLogs.length > 0) {
        logs = logs.concat(ethLogs.map((raw) => Log.fromValuesArray(raw)));
      }
    }

    // 6. call stakeManager.getTotalLockedAmountAndValidatorCount to get totalLockedAmount and validatorCount,
    //    and decide if we should enable genesis validators
    const { totalLockedAmount, validatorCount } = await parentStakeManager.getTotalLockedAmountAndValidatorCount();
    logger.debug('Reimint::afterApply, totalLockedAmount:', totalLockedAmount.toString(), 'validatorCount:', validatorCount.toString());
    const enableGenesisValidators = Reimint.isEnableGenesisValidators(totalLockedAmount, validatorCount.toNumber(), pendingCommon);

    // 7. calculate the next validator set according to enableGenesisValidators
    let validatorSet: ValidatorSet;
    if (enableGenesisValidators) {
      if (!parentValidatorSet.isGenesis(pendingCommon)) {
        logger.debug('Reimint::afterApply, EnableGenesisValidators, create a new genesis validator set');
        // if the parent validator set isn't a genesis validator set, we create a new one
        validatorSet = ValidatorSet.genesis(pendingCommon);
      } else {
        logger.debug('Reimint::afterApply, EnableGenesisValidators, copy from parent');
        // if the parent validator set is a genesis validator set, we copy the set from the parent
        validatorSet = parentValidatorSet.copy();
      }
    } else {
      if (parentValidatorSet.isGenesis(pendingCommon)) {
        logger.debug('Reimint::afterApply, DisableGenesisValidators, create a new normal validator set');
        // if the parent validator set is a genesis validator set, we create a new set from state trie
        validatorSet = await ValidatorSet.fromStakeManager(parentStakeManager, { sort: true });
      } else {
        logger.debug('Reimint::afterApply, DisableGenesisValidators, copy from parent and merge changes');
        // filter changes
        const changes = new ValidatorChanges(pendingCommon);
        StakeManager.filterReceiptsChanges(changes, receipts, pendingCommon);
        if (logs.length > 0) {
          StakeManager.filterLogsChanges(changes, logs, pendingCommon);
        }
        for (const uv of changes.unindexedValidators) {
          logger.debug('Reimint::processBlock, unindexedValidators, address:', uv.toString());
        }
        for (const vc of changes.changes.values()) {
          logger.debug('Reimint::processBlock, change, address:', vc.validator.toString(), 'votingPower:', vc.votingPower?.toString(), 'update:', vc.update.toString());
        }

        // merge changes
        validatorSet = parentValidatorSet!.copyAndMerge(changes, pendingCommon);
      }
    }

    // 8. increase once
    validatorSet.active.incrementProposerPriority(1);

    const activeValidators = validatorSet.active.activeValidators();
    if (activeValidators.length === 0) {
      throw new Error('activeValidators length is zero');
    }

    // 9. call stakeManager.onAfterBlock to save active validator set
    const activeSigners = activeValidators.map(({ validator }) => validator);
    const priorities = activeValidators.map(({ priority }) => priority);
    await parentStakeManager.onAfterBlock(validatorSet.active.proposer, activeSigners, priorities);

    const nextCommon = this.backend.getCommon(pendingBlock.header.number.addn(1));
    // 10. deploy contracts if enable hardfork 1 is enabled in the next block
    if (!isEnableHardfork1(pendingCommon) && isEnableHardfork1(nextCommon)) {
      const evm = new EVM(vm, new TxContext(new BN(0), EMPTY_ADDRESS), pendingBlock);
      await Contract.deployHardfork1Contracts(evm, nextCommon);
    }

    // 11. deploy contracts if enable free staking is enabled in the next block
    if (!isEnableFreeStaking(pendingCommon) && isEnableFreeStaking(nextCommon)) {
      const evm = new EVM(vm, new TxContext(new BN(0), EMPTY_ADDRESS), pendingBlock);
      await Contract.deployFreeStakingContracts(evm, nextCommon);
    }

    // 12. deploy contracts if validators rlp is enabled in the next block
    if (!isEnableValidatorsIndex(pendingCommon) && isEnableValidatorsIndex(nextCommon)) {
      const evm = new EVM(vm, new TxContext(new BN(0), EMPTY_ADDRESS), pendingBlock);
      await Contract.deployHardforkValRLPContract(evm, nextCommon);
    }

    return validatorSet;
  }

  /**
   * {@link Executor.finalize}
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
    const parentStakeManager = this.engine.getStakeManager(vm, block);
    const parentValidatorSet = (await this.engine.validatorSets.getValSet(parentStateRoot, parentStakeManager)).copy();
    parentValidatorSet.active.incrementProposerPriority(round);

    await vm.stateManager.checkpoint();
    try {
      await this.assignBlockReward(vm.stateManager, systemCaller, minerReward);
      const blockReward = (await vm.stateManager.getAccount(systemCaller)).balance;
      const validatorSet = await this.afterApply(vm, block, receipts, evidence, miner, blockReward, parentValidatorSet, parentStakeManager);
      await vm.stateManager.commit();
      const finalizedStateRoot = await vm.stateManager.getStateRoot();

      // put the validator set in the memory cache
      this.engine.validatorSets.set(finalizedStateRoot, validatorSet);

      return { finalizedStateRoot };
    } catch (err) {
      await vm.stateManager.revert();
      throw err;
    }
  }

  /**
   * {@link Executor.processBlock}
   */
  async processBlock(options: ProcessBlockOpts) {
    const { debug, block, force, skipConsensusValidation, skipConsensusVerify } = options;

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

    // get parent block from database
    const parent = await this.backend.db.getBlockByHashAndNumber(block.header.parentHash, pendingHeader.number.subn(1));

    // get state root and vm instance
    const root = parent.header.stateRoot;
    const vm = await this.backend.getVM(root, pendingCommon);

    const systemCaller = Address.fromString(pendingCommon.param('vm', 'scaddr'));
    const parentStakeManager = this.engine.getStakeManager(vm, block);
    let parentValidatorSet = await this.engine.validatorSets.getValSet(root, parentStakeManager);

    const extraData = ExtraData.fromBlockHeader(pendingHeader, { valSet: parentValidatorSet.active });
    const miner = extraData.proposal.proposer();

    // now, parentValidatorSet has increased extraData.proposal.round times
    parentValidatorSet = new ValidatorSet(parentValidatorSet.indexed, extraData.activeValidatorSet()!);

    if (!skipConsensusValidation) {
      extraData.validate();
    }

    if (!skipConsensusVerify) {
      await extraData.verifyEvidence(this.backend, this.engine);
      await this.engine.evpool.checkEvidence(extraData.evidence);
    }

    let runTxOpts: any;
    if (isEnableFreeStaking(pendingCommon)) {
      runTxOpts = {
        skipBalance: true,
        ...makeRunTxCallback(systemCaller, Address.fromString(pendingCommon.param('vm', 'faddr')), block.header.timestamp.toNumber(), await Fee.getTotalAmount(vm.stateManager))
      };
    } else {
      runTxOpts = {
        assignTxReward: async (state, value) => {
          await rewardAccount(state, systemCaller, value);
        }
      };
    }

    let validatorSet!: ValidatorSet;
    const runBlockOptions: RunBlockOpts = {
      block,
      root,
      debug,
      generate: false,
      skipBlockValidation: true,
      assignBlockReward: async (state, reward) => {
        await this.assignBlockReward(state, systemCaller, reward);
      },
      afterApply: async (state, { receipts: postByzantiumTxReceipts }) => {
        // assign all balances of systemCaller to miner
        const blockReward = (await state.getAccount(systemCaller)).balance;
        const receipts = postByzantiumTxReceiptsToReceipts(postByzantiumTxReceipts);
        validatorSet = await this.afterApply(vm, block, receipts, extraData.evidence, miner, blockReward, parentValidatorSet, parentStakeManager);
      },
      runTxOpts
    };

    const result = await vm.runBlock(runBlockOptions);

    const activeValidators = validatorSet.active.activeValidators();
    logger.debug(
      'Reimint::processBlock, activeValidators:',
      activeValidators.map(({ validator, priority }) => {
        return `address: ${validator.toString()} | priority: ${priority.toString()} | votingPower: ${validatorSet!.indexed.getVotingPower(validator).toString()}`;
      }),
      'next proposer:',
      validatorSet.active.proposer.toString()
    );

    // put the validator set in the memory cache
    this.engine.validatorSets.set(result.stateRoot, validatorSet);

    return { receipts: postByzantiumTxReceiptsToReceipts(result.receipts) };
  }

  /**
   * {@link Executor.processTx}
   */
  async processTx(options: ProcessTxOpts) {
    const { root, block, tx, blockGasUsed, totalAmount } = options;
    const systemCaller = Address.fromString(block._common.param('vm', 'scaddr'));
    const vm = await this.backend.getVM(root, block._common);

    let result: RunTxResult;
    if (isEnableFreeStaking(block._common)) {
      const feeAddr = Address.fromString(block._common.param('vm', 'faddr'));

      if (totalAmount === undefined) {
        throw new Error('missing total amount');
      }

      result = await vm.runTx({
        skipBalance: true,
        tx,
        block,
        blockGasUsed,
        ...makeRunTxCallback(systemCaller, feeAddr, block.header.timestamp.toNumber(), totalAmount)
      });
    } else {
      result = await vm.runTx({
        tx,
        block,
        blockGasUsed,
        assignTxReward: async (state, value) => {
          await rewardAccount(state, systemCaller, value);
        }
      });
    }

    return {
      receipt: postByzantiumTxReceiptsToReceipts([result.receipt])[0],
      gasUsed: result.gasUsed,
      bloom: result.bloom,
      root: await vm.stateManager.getStateRoot()
    };
  }
}
