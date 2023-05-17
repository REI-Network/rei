import { Address, BN, BNLike, bufferToHex } from 'ethereumjs-util';
import { Database } from '@rei-network/database';
import { logger, FunctionalAddressMap } from '@rei-network/utils';
import { Blockchain } from '@rei-network/blockchain';
import { Common } from '@rei-network/common';
import { Block, Log, Receipt, TypedTransaction } from '@rei-network/structure';
import { RunBlockOpts, rewardAccount } from '@rei-network/vm/dist/runBlock';
import { StateManager as IStateManager } from '@rei-network/vm/dist/state';
import { RunTxResult } from '@rei-network/vm/dist/runTx';
import { VM } from '@rei-network/vm';
import Bloom from '@rei-network/vm/dist/bloom';
import { IDebug } from '@rei-network/vm/dist/types';
import EVM, { EVMWorkMode } from '@rei-network/vm/dist/evm/evm';
import TxContext from '@rei-network/vm/dist/evm/txContext';
import { postByzantiumTxReceiptsToReceipts, EMPTY_ADDRESS } from '../utils';
import { isEnableFreeStaking, isEnableHardfork1, isEnableHardfork2, isEnableBetterPOS, isEnableDAO } from '../hardforks';
import { StateManager } from '../stateManager';
import { ValidatorSet, ValidatorChanges, isGenesis, IndexedValidatorSet, ActiveValidatorSet } from './validatorSet';
import { StakeManager, SlashReason, Fee, Contract, ValidatorBls } from './contracts';
import { Reimint } from './reimint';
import { Evidence, DuplicateVoteEvidence } from './evpool';
import { ExtraData } from './extraData';
import { ReimintEngine } from './engine';
import { makeRunTxCallback } from './makeRunTxCallback';

export interface FinalizeOpts {
  block: Block;
  stateRoot: Buffer;
  receipts: Receipt[];

  round?: number;
  evidence?: Evidence[];
  parentStateRoot?: Buffer;
}

export interface FinalizeResult {
  finalizedStateRoot: Buffer;
}

export interface ProcessBlockOpts {
  block: Block;
  force?: boolean;
  debug?: IDebug;
  skipConsensusValidation?: boolean;
  skipConsensusVerify?: boolean;
}

export interface ProcessBlockResult {
  receipts: Receipt[];
}

export interface ProcessTxOpts {
  block: Block;
  root: Buffer;
  tx: TypedTransaction;
  blockGasUsed?: BN;

  totalAmount?: BN;
}

export interface ProcessTxResult {
  receipt: Receipt;
  gasUsed: BN;
  bloom: Bloom;
  root: Buffer;
}

export interface ExecutorBackend {
  readonly db: Database;
  readonly blockchain: Blockchain;
  getCommon(num: BNLike): Common;
  getStateManager(root: Buffer, num: BNLike | Common, snap?: boolean): Promise<StateManager>;
  getVM(root: Buffer, num: BNLike | Common, snap?: boolean, mode?: EVMWorkMode): Promise<VM>;
}

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

export class ReimintExecutor {
  constructor(private readonly backend: ExecutorBackend, private readonly engine: ReimintEngine) {}

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
   *                      totalReward = minerReward + accBalUsage + etc(if some one transfer REI to system caller address)
   * @param parentStateRoot - Parent state trie root
   * @param parentValidatorSet - Validator set loaded from parent state trie
   * @param parentStakeManager - Stake manager contract instance
   *                             (used to load totalLockedAmount and validatorCount and validatorSet if need)
   * @returns New validator set
   */
  async afterApply(vm: VM, pendingBlock: Block, receipts: Receipt[], evidence: Evidence[], miner: Address, totalReward: BN, parentStateRoot: Buffer, parentValidatorSet: ValidatorSet, parentStakeManager: StakeManager) {
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

      let minerFactor: BN;
      const totalBlockReward = totalReward.sub(accBalUsage);
      if (isEnableDAO(pendingCommon)) {
        minerFactor = (await this.engine.configCache.get(parentStateRoot, pendingBlock)).minerRewardFactor;
      } else {
        const numberMinerFactor = pendingCommon.param('vm', 'minerRewardFactor');
        if (typeof numberMinerFactor !== 'number' || numberMinerFactor > 100 || numberMinerFactor < 0) {
          throw new Error('invalid miner factor');
        }
        minerFactor = new BN(numberMinerFactor);
      }

      /**
       * If free staking is enable,
       * minerReward = (totalReward - accBalUsage) * minerRewardFactor / 100
       * feePoolReward = totalReward - minerReward
       */
      minerReward = totalBlockReward.mul(minerFactor).divn(100);
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
        logger.debug('Reimint::afterApply, find evidence(h,r,v,ha,hb):', voteA.height.toString(), voteA.round, voteA.getValidator().toString(), bufferToHex(voteA.hash), bufferToHex(voteB.hash));

        let ethLogs: any[] | undefined;
        if (isEnableBetterPOS(pendingCommon)) {
          // if the contract has been upgraded, call the new slashing function
          ethLogs = await parentStakeManager.slashV2(ev.voteA.getValidator(), SlashReason.DuplicateVote, ev.hash());
        } else {
          ethLogs = await parentStakeManager.slash(ev.voteA.getValidator(), SlashReason.DuplicateVote);
        }
        if (ethLogs && ethLogs.length > 0) {
          logs = logs.concat(ethLogs.map((raw) => Log.fromValuesArray(raw)));
        }
      } else {
        throw new Error('unknown evidence');
      }
    }

    // 4. call stakeManager.addMissRecord to add miss record
    // and jail validators whos missed records is greater than config.jailThreshold
    if (isEnableBetterPOS(pendingCommon)) {
      let missRecords: string[][] = [];
      const preBlockHeader = await this.engine.node.db.getHeader(pendingBlock.header.parentHash, pendingBlock.header.number.subn(1));
      if (preBlockHeader.number.gten(1)) {
        const missMinerMap = new FunctionalAddressMap<number>();
        const roundNumber = ExtraData.fromBlockHeader(preBlockHeader).round;
        if (roundNumber > 0) {
          const preParentBlock = await this.engine.node.db.getBlock(preBlockHeader.parentHash);
          const common = preParentBlock._common;
          const vm = await this.backend.getVM(preParentBlock.header.stateRoot, common);
          const stakeManager = this.engine.getStakeManager(vm, preParentBlock);
          const activeSets = (await this.engine.validatorSets.getActiveValSet(preParentBlock.header.stateRoot, stakeManager)).copy();
          for (let round = 0; round < roundNumber; round++) {
            const missminer = activeSets.proposer;
            missMinerMap.set(missminer, (missMinerMap.get(missminer) ?? 0) + 1);
            activeSets.incrementProposerPriority(1);
          }
          // genesis validators are not allowed to record miss recordss
          missRecords = Array.from(missMinerMap.entries())
            .filter(([addr]) => !isGenesis(addr, common))
            .map(([addr, count]) => [addr.toString(), count.toString()]);
        }
      }
      logger.debug('Reimint::afterApply, add miss records:', missRecords);
      const ethLogs = await parentStakeManager.addMissRecord(missRecords);
      if (ethLogs && ethLogs.length > 0) {
        logs = logs.concat(ethLogs.map((raw) => Log.fromValuesArray(raw)));
      }
    }

    if (isEnableFreeStaking(pendingCommon)) {
      // 5. filter all receipts to collect free staking changes,
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

      // 6. calculate miner amount and distributed value,
      //    and call feePool.distribute
      const minerAmount = accBalUsage!.add(accFeeUsage!);
      const distributeValue = feePoolReward.add(accBalUsage!);
      const feePool = this.engine.getFeePool(vm, pendingBlock, pendingCommon);
      const ethLogs = await feePool!.distribute(miner, minerAmount, distributeValue);
      if (ethLogs && ethLogs.length > 0) {
        logs = logs.concat(ethLogs.map((raw) => Log.fromValuesArray(raw)));
      }
    }

    let validatorSet: ValidatorSet = parentValidatorSet.copy();
    let indexedValidatorSet: IndexedValidatorSet = parentValidatorSet.indexed.copy();
    const nextCommon = this.backend.getCommon(pendingBlock.header.number.addn(1));
    const changes = new ValidatorChanges(pendingCommon);
    StakeManager.filterReceiptsChanges(changes, receipts, pendingCommon);
    if (logs.length > 0) {
      StakeManager.filterLogsChanges(changes, logs, pendingCommon);
    }

    // 7. filter all receipts to collect changes
    if (isEnableDAO(pendingCommon)) {
      ValidatorBls.filterReceiptsChanges(changes, receipts, pendingCommon);
      await indexedValidatorSet.merge(changes, this.engine.getValidatorBls(vm, pendingBlock, pendingCommon));
    } else if (!isEnableDAO(pendingCommon) && isEnableDAO(nextCommon)) {
      // modify validatorBls contract address
      const fallbackAddr = nextCommon.param('vm', 'fallbackaddr');
      const postAddr = nextCommon.param('vm', 'postaddr');
      if (fallbackAddr === undefined || postAddr === undefined) {
        throw new Error('load bls contract addresses failed');
      }
      const addr = Address.fromString(postAddr);
      const fallback = await vm.stateManager.getAccount(Address.fromString(fallbackAddr));
      const post = await vm.stateManager.getAccount(addr);
      post.stateRoot = fallback.stateRoot;
      post.codeHash = fallback.codeHash;
      await vm.stateManager.putAccount(addr, post);
      const validatorBls = this.engine.getValidatorBls(vm, pendingBlock, nextCommon);
      indexedValidatorSet = await IndexedValidatorSet.fromStakeManager(parentStakeManager, validatorBls);
      // deploy validatorBlsFallback contract
      const evm = new EVM(vm, new TxContext(new BN(0), EMPTY_ADDRESS), pendingBlock);
      await Contract.deloyValidatorBlsFallbackContract(evm, nextCommon);
    } else {
      await indexedValidatorSet.merge(changes);
    }

    // 8. get totalLockedAmount and validatorCount by the merged validatorSet,
    //    and decide if we should enable genesis validators
    const { totalLockedAmount, validatorCount } = indexedValidatorSet.getTotalLockedVotingPowerAndValidatorCount(isEnableDAO(nextCommon));
    logger.debug('Reimint::afterApply, totalLockedAmount:', totalLockedAmount.toString(), 'validatorCount:', validatorCount.toString());
    const enableGenesisValidators = Reimint.isEnableGenesisValidators(totalLockedAmount, validatorCount.toNumber(), nextCommon);
    if (enableGenesisValidators) {
      if (!parentValidatorSet.isGenesis(nextCommon)) {
        logger.debug('Reimint::afterApply, EnableGenesisValidators, create a new genesis validator set');
        // if the parent validator set isn't a genesis validator set, we create a new one
        if (isEnableDAO(nextCommon)) {
          validatorSet = new ValidatorSet(indexedValidatorSet, await ActiveValidatorSet.genesis(nextCommon, this.engine.getValidatorBls(vm, pendingBlock, nextCommon)));
        } else {
          validatorSet = new ValidatorSet(indexedValidatorSet, await ActiveValidatorSet.genesis(nextCommon));
        }
      } else {
        logger.debug('Reimint::afterApply, EnableGenesisValidators, copy from parent');
        // if the parent validator set is a genesis validator set, we copy the set from the parent
        if (!isEnableDAO(pendingCommon) && isEnableDAO(nextCommon)) {
          validatorSet = new ValidatorSet(indexedValidatorSet, await ActiveValidatorSet.genesis(nextCommon, this.engine.getValidatorBls(vm, pendingBlock, nextCommon)));
        } else {
          const active = parentValidatorSet.active.copy();
          if (isEnableDAO(pendingCommon)) {
            active.reloadBlsPublicKey(changes);
          }
          validatorSet = new ValidatorSet(indexedValidatorSet, active);
        }
      }
    } else {
      const maxCount = nextCommon.param('vm', 'maxValidatorsCount');
      const active = parentValidatorSet.active.copy();
      active.merge(indexedValidatorSet.sort(maxCount, isEnableDAO(nextCommon)));
      active.computeNewPriorities(parentValidatorSet.active.copy());
      validatorSet = new ValidatorSet(indexedValidatorSet, active);
    }

    // 9. increase once
    validatorSet.active.incrementProposerPriority(1);

    // make sure there is at least one validator
    const activeValidators = validatorSet.active.activeValidators();
    if (activeValidators.length === 0) {
      throw new Error('activeValidators length is zero');
    }

    // 10. call stakeManager.onAfterBlock to save active validator set
    const activeSigners = activeValidators.map(({ validator }) => validator);
    const priorities = activeValidators.map(({ priority }) => priority);
    if (isEnableBetterPOS(pendingCommon)) {
      await parentStakeManager.onAfterBlockV2(validatorSet.active.proposer, activeSigners, priorities);
    } else {
      await parentStakeManager.onAfterBlock(validatorSet.active.proposer, activeSigners, priorities);
    }

    // 11. deploy contracts if hardfork 1 is enabled in the next block
    if (!isEnableHardfork1(pendingCommon) && isEnableHardfork1(nextCommon)) {
      const evm = new EVM(vm, new TxContext(new BN(0), EMPTY_ADDRESS), pendingBlock);
      await Contract.deployHardfork1Contracts(evm, nextCommon);
    }

    // 12. deploy contracts if free staking is enabled in the next block
    if (!isEnableFreeStaking(pendingCommon) && isEnableFreeStaking(nextCommon)) {
      const evm = new EVM(vm, new TxContext(new BN(0), EMPTY_ADDRESS), pendingBlock);
      await Contract.deployFreeStakingContracts(evm, nextCommon);
    }

    // 13. deploy contracts if hardfork 2 is enabled in the next block
    if (!isEnableHardfork2(pendingCommon) && isEnableHardfork2(nextCommon)) {
      const evm = new EVM(vm, new TxContext(new BN(0), EMPTY_ADDRESS), pendingBlock);
      await Contract.deployHardfork2Contracts(evm, nextCommon);

      // migrate evidence hashes
      if (!this.engine.collector) {
        throw new Error('missing collector');
      }
      await Contract.deployHardfork2Contracts(evm, nextCommon);
      const pendingStakeManager = new StakeManager(evm, pendingCommon);
      const hashes = [...this.engine.collector.getHashes(pendingBlock.header.number.subn(1)), ...evidence.map((ev) => ev.hash())];
      await pendingStakeManager.initEvidenceHash(hashes);
    }

    // 14. deploy contracts if prison is enabled in the next block
    if (!isEnableBetterPOS(pendingCommon) && isEnableBetterPOS(nextCommon)) {
      const evm = new EVM(vm, new TxContext(new BN(0), EMPTY_ADDRESS), pendingBlock);
      await Contract.deployBetterPOSContracts(evm, nextCommon);
    }

    return validatorSet;
  }

  /**
   * Finalize a pending block,
   * assign block reward to miner and
   * do other things(afterApply) and
   * calculate finalized state root
   * @param options - Finalize options
   * @return FinalizeResult
   */
  async finalize(options: FinalizeOpts) {
    let { block, receipts, stateRoot, parentStateRoot, round, evidence } = options;
    if (round === undefined || evidence === undefined || !parentStateRoot) {
      throw new Error('missing state root or round or evidence');
    }

    const pendingCommon = block._common;
    const vm = await this.backend.getVM(stateRoot, pendingCommon, true);

    const miner = Reimint.getMiner(block);
    const systemCaller = Address.fromString(pendingCommon.param('vm', 'scaddr'));
    const parentStakeManager = this.engine.getStakeManager(vm, block);
    let minerReward: BN;
    let parentValidatorSet: ValidatorSet;
    if (isEnableDAO(pendingCommon)) {
      minerReward = (await this.engine.configCache.get(parentStateRoot, block)).minerReward;
      const bls = this.engine.getValidatorBls(vm, block, pendingCommon);
      parentValidatorSet = (await this.engine.validatorSets.getValSet(parentStateRoot, parentStakeManager, bls)).copy();
    } else {
      minerReward = new BN(pendingCommon.param('pow', 'minerReward'));
      parentValidatorSet = (await this.engine.validatorSets.getValSet(parentStateRoot, parentStakeManager)).copy();
    }
    parentValidatorSet.active.incrementProposerPriority(round);

    // filter the evidence that has been packaged to prevent duplication
    if (evidence && isEnableBetterPOS(pendingCommon)) {
      let filteredEvidence: Evidence[] = [];
      for (const ev of evidence) {
        if (!(await parentStakeManager.isUsedEvidence(ev.hash()))) {
          filteredEvidence.push(ev);
        }
      }
      evidence = filteredEvidence;
    }

    await vm.stateManager.checkpoint();
    try {
      await this.assignBlockReward(vm.stateManager, systemCaller, minerReward);
      const blockReward = (await vm.stateManager.getAccount(systemCaller)).balance;
      const validatorSet = await this.afterApply(vm, block, receipts, evidence, miner, blockReward, parentStateRoot, parentValidatorSet, parentStakeManager);
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
   * Process a block
   * @param options - Process block options
   * @returns ProcessBlockResult or undefined
   */
  async processBlock(options: ProcessBlockOpts) {
    const startAt = Date.now();

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

    // get state root
    const root = parent.header.stateRoot;
    // select evm impl by debug
    // TODO: support evmc binding debug
    const mode: EVMWorkMode | undefined = debug ? EVMWorkMode.JS : undefined;
    // get vm instance
    const vm = await this.backend.getVM(root, pendingCommon, true, mode);

    const systemCaller = Address.fromString(pendingCommon.param('vm', 'scaddr'));
    const parentStakeManager = this.engine.getStakeManager(vm, block);

    let parentValidatorSet: ValidatorSet = isEnableDAO(pendingCommon) ? (await this.engine.validatorSets.getValSet(root, parentStakeManager, this.engine.getValidatorBls(vm, block, pendingCommon))).copy() : (await this.engine.validatorSets.getValSet(root, parentStakeManager)).copy();

    const extraData = ExtraData.fromBlockHeader(pendingHeader, { valSet: parentValidatorSet.active });
    const miner = extraData.proposal.getProposer();

    // now, parentValidatorSet has increased extraData.proposal.round times
    parentValidatorSet = new ValidatorSet(parentValidatorSet.indexed, extraData.activeValidatorSet()!);

    if (!skipConsensusValidation) {
      // validate extra data basic format
      extraData.validate();
    }

    if (!skipConsensusVerify) {
      // verify evidence signer
      await extraData.verifyEvidence(this.backend, this.engine);
      // verify committed evidence
      await this.engine.evpool.checkEvidence(extraData.evidence);
      // verify used evidence
      if (isEnableBetterPOS(pendingCommon)) {
        for (const ev of extraData.evidence) {
          if (await parentStakeManager.isUsedEvidence(ev.hash())) {
            throw new Error('used evidence');
          }
        }
      }
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
      assignBlockReward: async (state, outsideReward) => {
        let reward: BN;
        if (isEnableDAO(pendingCommon)) {
          // load reward from config contract
          reward = (await this.engine.configCache.get(root, block)).minerReward;
        } else {
          // use outside reward
          reward = outsideReward;
        }
        await this.assignBlockReward(state, systemCaller, reward);
      },
      afterApply: async (state, { receipts: postByzantiumTxReceipts }) => {
        // assign all balances of systemCaller to miner
        const blockReward = (await state.getAccount(systemCaller)).balance;
        const receipts = postByzantiumTxReceiptsToReceipts(postByzantiumTxReceipts);
        validatorSet = await this.afterApply(vm, block, receipts, extraData.evidence, miner, blockReward, root, parentValidatorSet, parentStakeManager);
      },
      runTxOpts
    };

    const result = await vm.runBlock(runBlockOptions);

    const activeValidators = validatorSet.active.activeValidators();
    const indexedValidators = Array.from(validatorSet.indexed.indexed.values());
    logger.debug(
      'Reimint::processBlock, activeValidators:',
      activeValidators.map(({ validator, priority, blsPublicKey }) => {
        return `address: ${validator.toString()} | priority: ${priority.toString()} | votingPower: ${isGenesis(validator, pendingCommon) ? '1' : validatorSet!.indexed.getVotingPower(validator).toString()} | pk: ${!!blsPublicKey ? 'exists' : "doesn't exist"}`;
      }),
      'next proposer:',
      validatorSet.active.proposer.toString()
    );

    logger.debug(
      'Reimint::processBlock, indexValidatorSet:',
      indexedValidators.map(({ validator, votingPower, blsPublicKey }) => {
        return `address: ${validator.toString()} | votingPower: ${votingPower.toString()} | pk: ${!!blsPublicKey ? 'exists' : "doesn't exist"}`;
      }),
      'next proposer:',
      validatorSet.active.proposer.toString()
    );

    // put the validator set in the memory cache
    this.engine.validatorSets.set(result.stateRoot, validatorSet);

    logger.debug('Reimint::processBlock, mode:', vm.mode ?? EVMWorkMode.JS, 'tx:', block.transactions.length, 'usage:', Date.now() - startAt);

    return { receipts: postByzantiumTxReceiptsToReceipts(result.receipts) };
  }

  /**
   * Process a transaction
   * @param options - Process transaction options
   * @returns ProcessTxResult
   */
  async processTx(options: ProcessTxOpts) {
    const { root, block, tx, blockGasUsed, totalAmount } = options;
    const systemCaller = Address.fromString(block._common.param('vm', 'scaddr'));
    const vm = await this.backend.getVM(root, block._common, true);

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
