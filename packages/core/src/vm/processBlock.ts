import { bufferToHex, BN, Address } from 'ethereumjs-util';
import { DBSaveReceipts, DBSaveTxLookup } from '@gxchain2/database';
import VM from '@gxchain2-ethereumjs/vm';
import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import TxContext from '@gxchain2-ethereumjs/vm/dist/evm/txContext';
import { PostByzantiumTxReceipt } from '@gxchain2-ethereumjs/vm/dist/types';
import { RunBlockOpts, rewardAccount } from '@gxchain2-ethereumjs/vm/dist/runBlock';
import { StateManager as IStateManager } from '@gxchain2-ethereumjs/vm/dist/state';
import { Receipt, Log, Block } from '@gxchain2/structure';
import { Common } from '@gxchain2/common';
import { logger } from '@gxchain2/utils';
import { ValidatorChanges, ValidatorSet } from '../staking';
import { StakeManager, Router, Contract } from '../contracts';
import { ExtraData } from '../consensus/reimint/extraData';
import { preHF1ConsensusValidateHeader } from '../validation';
import { isEnableReceiptRootFix, isEnableStaking, genReceiptTrie, preHF1GenReceiptTrie } from '../hardforks';
import { Node } from '../node';
import { makeRunTxCallback } from './processTx';
import { ConsensusEngine } from '../consensus';

export function postByzantiumTxReceiptsToReceipts(receipts: PostByzantiumTxReceipt[]) {
  return receipts.map(
    (r) =>
      new Receipt(
        r.gasUsed,
        r.bitvector,
        r.logs.map((l) => new Log(l[0], l[1], l[2])),
        r.status
      )
  );
}

export function isEnableGenesisValidators(totalLockedAmount: BN, validatorCount: number, common: Common) {
  const minTotalLockedAmount = common.param('vm', 'minTotalLockedAmount');
  if (typeof minTotalLockedAmount !== 'string') {
    throw new Error('invalid minTotalLockedAmount');
  }
  if (totalLockedAmount.lt(new BN(minTotalLockedAmount))) {
    return true;
  }

  const minValidatorsCount = common.param('vm', 'minValidatorsCount');
  if (typeof minValidatorsCount !== 'number') {
    throw new Error('invalid minValidatorsCount');
  }
  if (validatorCount < minValidatorsCount) {
    return true;
  }

  return false;
}

export async function makeRunBlockCallback(node: Node, vm: VM, engine: ConsensusEngine, pendingBlock: Block, runTxOpts: any, parentStakeManager?: StakeManager, parentValidatorSet?: ValidatorSet) {
  const pendingHeader = pendingBlock.header;
  const pendingCommon = pendingBlock._common;
  const enableStaking = isEnableStaking(pendingCommon);

  // get miner through consensus engine
  const miner = engine.getMiner(pendingHeader);

  let parentRouter: Router | undefined;
  let systemCaller: Address | undefined;
  if (enableStaking) {
    systemCaller = Address.fromString(pendingCommon.param('vm', 'scaddr'));
    parentRouter = node.getRouter(vm, pendingBlock);
    if (!parentValidatorSet) {
      throw new Error('missing parentValidatorSet');
    }
    if (!parentStakeManager) {
      throw new Error('missing parentStakeManager');
    }
  }

  let receipts: Receipt[] | undefined;
  let validatorSet: ValidatorSet | undefined;
  const blockReward = new BN(0);
  return {
    genReceiptTrie: isEnableReceiptRootFix(pendingCommon) ? genReceiptTrie : preHF1GenReceiptTrie,
    assignBlockReward: async (state: IStateManager, reward: BN) => {
      if (enableStaking) {
        // if staking is active, assign reward to system caller address
        await rewardAccount(state, systemCaller!, reward);
        blockReward.iadd(reward);
      } else {
        // directly reward miner
        await rewardAccount(state, miner, reward);
      }
    },
    afterApply: async (state, { receipts: postByzantiumTxReceipts }) => {
      receipts = postByzantiumTxReceiptsToReceipts(postByzantiumTxReceipts as PostByzantiumTxReceipt[]);

      if (enableStaking) {
        let logs: Log[] | undefined;
        const ethLogs = await parentRouter!.assignBlockReward(miner, blockReward);
        if (ethLogs && ethLogs.length > 0) {
          logs = ethLogs.map((raw) => Log.fromValuesArray(raw));
        }

        parentValidatorSet = parentValidatorSet!;
        const stakeManager = parentStakeManager!;
        const totalLockedAmount = await stakeManager.totalLockedAmount();
        const validatorCount = (await stakeManager.indexedValidatorsLength()).toNumber();
        const enableGenesisValidators = isEnableGenesisValidators(totalLockedAmount, validatorCount, pendingCommon);

        console.log('processBlock, enableGenesisValidators:', enableGenesisValidators);

        if (enableGenesisValidators) {
          if (!parentValidatorSet.isGenesisValidatorSet()) {
            console.log('processBlock, create a new genesis validator set');
            // if the parent validator set isn't a genesis validator set, we create a new one
            validatorSet = ValidatorSet.createGenesisValidatorSet(pendingCommon);
          } else {
            console.log('processBlock, copy from parent');
            // if the parent validator set is a genesis validator set, we copy the set from the parent
            validatorSet = parentValidatorSet.copy();
          }
        } else {
          if (parentValidatorSet.isGenesisValidatorSet()) {
            console.log('processBlock, create a new validator set');
            // if the parent validator set is a genesis validator set, we create a new set from state trie
            validatorSet = await ValidatorSet.createFromStakeManager(stakeManager, true);
          } else {
            console.log('processBlock, copy from parent and merge changes');
            // filter changes
            const changes = new ValidatorChanges(parentValidatorSet);
            StakeManager.filterReceiptsChanges(changes, receipts, pendingCommon);
            if (logs) {
              StakeManager.filterLogsChanges(changes, logs, pendingCommon);
            }
            for (const uv of changes.unindexedValidators) {
              logger.debug('Node::processBlock, unindexedValidators, address:', uv.toString());
            }
            for (const vc of changes.changes.values()) {
              logger.debug('Node::processBlock, change, address:', vc.validator.toString(), 'votingPower:', vc.votingPower?.toString(), 'update:', vc.update.toString());
            }

            // copy from parent
            validatorSet = parentValidatorSet!.copy();
            // merge changes
            validatorSet.mergeChanges(changes);
          }
        }

        // increase once
        validatorSet.incrementProposerPriority(1);
      } else {
        const nextCommon = node.getCommon(pendingHeader.number.addn(1));
        if (isEnableStaking(nextCommon)) {
          // deploy system contracts
          const evm = new EVM(vm, new TxContext(new BN(0), Address.zero()), pendingBlock);
          await Contract.deploy(evm, nextCommon);

          parentRouter = new Router(evm, nextCommon);
          validatorSet = ValidatorSet.createGenesisValidatorSet(nextCommon);

          // start consensus engine
          node.getReimintEngine()?.start();
        }
      }

      if (validatorSet) {
        const activeValidators = validatorSet.activeValidators();
        logger.debug(
          'Node::processBlock, activeValidators:',
          activeValidators.map(({ validator, priority }) => {
            return `address: ${validator.toString()} | priority: ${priority.toString()} | votingPower: ${validatorSet!.getVotingPower(validator).toString()}`;
          })
        );

        // proposer = validatorSet.proposer;
        const activeSigners = activeValidators.map(({ validator }) => validator);
        const priorities = activeValidators.map(({ priority }) => priority);
        // call after block callback to save active validators list
        await parentRouter!.onAfterBlock(activeSigners, priorities);
      }
    },
    runTxOpts: { ...(enableStaking ? makeRunTxCallback(parentRouter!, systemCaller!, miner, pendingHeader.timestamp.toNumber()) : undefined), ...runTxOpts },
    onAfterRunBlock: async (node: Node, generatedBlock: Block) => {
      // save validator set
      if (validatorSet) {
        node.validatorSets.set(generatedBlock.header.stateRoot, validatorSet);
      }

      // save block
      await node.blockchain.putBlock(generatedBlock);
      // save receipts
      await node.db.batch(DBSaveTxLookup(generatedBlock).concat(DBSaveReceipts(receipts!, generatedBlock.hash(), generatedBlock.header.number)));
    }
  };
}

export interface ProcessBlockOpts extends Pick<RunBlockOpts, 'block' | 'runTxOpts'> {
  skipConsensusValidation?: boolean;
}

export async function processBlock(this: Node, options: ProcessBlockOpts) {
  const { block } = options;
  const header = block.header;
  // ensure that every transaction is in the right common
  for (const tx of block.transactions) {
    tx.common.getHardforkByBlockNumber(header.number);
  }

  const pendingHeader = block.header;
  const pendingCommon = block._common;
  const enableStaking = isEnableStaking(pendingCommon);

  // get parent header
  const parent = await this.db.getHeader(pendingHeader.parentHash, pendingHeader.number.subn(1));
  const vm = await this.getVM(parent.stateRoot, pendingCommon);
  const engine = this.getEngineByCommon(pendingCommon);

  let parentValidatorSet: ValidatorSet | undefined;
  let parentStakeManager: StakeManager | undefined;
  if (enableStaking) {
    parentStakeManager = this.getStakeManager(vm, block);
    parentValidatorSet = await this.validatorSets.get(parent.stateRoot, parentStakeManager);
    const extraData = ExtraData.fromBlockHeader(pendingHeader, { valSet: parentValidatorSet, increaseValSet: true });
    parentValidatorSet = extraData.validatorSet()!;
    if (!options.skipConsensusValidation) {
      extraData.validate();
    }
  } else {
    if (!options.skipConsensusValidation) {
      preHF1ConsensusValidateHeader.call(pendingHeader, this.blockchain);
    }
  }

  const callbacks = await makeRunBlockCallback(this, vm, engine, block, options.runTxOpts, parentStakeManager, parentValidatorSet);

  const runBlockOptions: RunBlockOpts = {
    generate: false,
    block,
    skipBlockValidation: true,
    root: parent.stateRoot,
    ...callbacks
  };

  await vm.runBlock(runBlockOptions);

  logger.info('✨ Process block, height:', header.number.toString(), 'hash:', bufferToHex(block.hash()));
  const before = this.blockchain.latestBlock.hash();

  // call `onAfterRunBlock` to save receipts and block
  console.log('beforePutBlock:', block.header.extraData.toString('hex'), block.header.number.toNumber());
  await callbacks.onAfterRunBlock(this, block);

  const after = this.blockchain.latestBlock.hash();

  return !before.equals(after);
}
