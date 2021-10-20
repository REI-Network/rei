import { bufferToHex, BN, Address } from 'ethereumjs-util';
import { DBSaveReceipts, DBSaveTxLookup } from '@gxchain2/database';
import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import TxContext from '@gxchain2-ethereumjs/vm/dist/evm/txContext';
import { PostByzantiumTxReceipt } from '@gxchain2-ethereumjs/vm/dist/types';
import { RunBlockOpts, rewardAccount } from '@gxchain2-ethereumjs/vm/dist/runBlock';
import { StateManager as IStateManager } from '@gxchain2-ethereumjs/vm/dist/state';
import { Receipt, Log } from '@gxchain2/structure';
import { logger } from '@gxchain2/utils';
import { ValidatorChanges, ValidatorSet, getGenesisValidators } from '../staking';
import { StakeManager, Router, Contract } from '../contracts';
import { ExtraData } from '../consensus/reimint/extraData';
import { preHF1ConsensusValidateHeader } from '../validation';
import { isEnableReceiptRootFix, isEnableStaking, preHF1GenReceiptTrie } from '../hardforks';
import { Node } from '../node';
import { makeRunTxCallback } from './processTx';

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

export interface ProcessBlockOpts extends Pick<RunBlockOpts, 'generate' | 'block' | 'runTxOpts'> {
  skipConsensusValidation?: boolean;
}

export async function processBlock(this: Node, options: ProcessBlockOpts) {
  let { block, generate } = options;
  let header = block.header;
  // ensure that every transaction is in the right common
  for (const tx of block.transactions) {
    tx.common.getHardforkByBlockNumber(header.number);
  }

  // get engine by block common
  const engine = this.getEngineByCommon(block.header._common);
  // get parent block
  const parent = await this.db.getBlockByHashAndNumber(header.parentHash, header.number.subn(1));
  // create a vm instance
  const vm = await this.getVM(parent.header.stateRoot, block._common);
  // check hardfork
  // const parentEnableStaking = isEnableStaking(parent._common);
  const enableStaking = isEnableStaking(block._common);

  const miner = engine.getMiner(block);
  let parentValidatorSet: ValidatorSet | undefined;
  let parentRouter: Router | undefined;
  let parentStakeManager: StakeManager | undefined;
  let systemCaller: Address | undefined;
  if (enableStaking) {
    systemCaller = Address.fromString(block._common.param('vm', 'scaddr'));
    parentRouter = this.getRouter(vm, block);
    parentStakeManager = this.getStakeManager(vm, block);

    parentValidatorSet = await this.validatorSets.get(parent.header.stateRoot, parentStakeManager);
    const extraData = ExtraData.fromBlockHeader(header, { valSet: parentValidatorSet, increaseValSet: true });
    parentValidatorSet = extraData.validatorSet()!;
    if (!options.skipConsensusValidation) {
      extraData.validate();
    }
    if (header.difficulty.eqn(1)) {
      logger.debug('Node::processBlock, number:', header.number.toString(), 'this block should mint by:', parentValidatorSet.proposer.toString(), ', but minted by:', miner.toString());
    } else {
      logger.debug('Node::processBlock, number:', header.number.toString(), 'this block should mint by:', parentValidatorSet.proposer.toString());
    }
  } else {
    if (!options.skipConsensusValidation) {
      preHF1ConsensusValidateHeader.call(header, this.blockchain);
    }
  }

  let receipts!: Receipt[];
  // let proposer: Address | undefined;
  let blockReward = new BN(0);
  // let activeSigners!: Address[];
  const runBlockOptions: RunBlockOpts = {
    generate,
    block,
    skipBlockValidation: true,
    root: parent.header.stateRoot,
    // if the current hardfork is less than `hardfork1`, then use the old logic `preHF1GenReceiptTrie`
    genReceiptTrie: isEnableReceiptRootFix(block._common) ? undefined : preHF1GenReceiptTrie,
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
      let validatorSet: ValidatorSet | undefined;

      if (enableStaking) {
        let logs: Log[] | undefined;
        const ethLogs = await parentRouter!.assignBlockReward(miner, blockReward);
        if (ethLogs && ethLogs.length > 0) {
          logs = ethLogs.map((raw) => Log.fromValuesArray(raw));
        }

        // filter changes
        const changes = new ValidatorChanges(parentValidatorSet!);
        StakeManager.filterReceiptsChanges(changes, receipts, block._common);
        if (logs) {
          StakeManager.filterLogsChanges(changes, logs, block._common);
        }
        for (const uv of changes.unindexedValidators) {
          logger.debug('Node::processBlock, unindexedValidators, address:', uv.toString());
        }
        for (const vc of changes.changes.values()) {
          logger.debug('Node::processBlock, change, address:', vc.validator.toString(), 'votingPower:', vc?.votingPower?.toString(), 'update:', vc.update.toString());
        }

        // copy from parent
        validatorSet = parentValidatorSet!.copy();
        // merge changes
        await validatorSet.mergeChanges(changes, parentStakeManager!);
        // increase once
        validatorSet.incrementProposerPriority(1);
      } else {
        const nextCommon = this.getCommon(header.number.addn(1));
        if (isEnableStaking(nextCommon)) {
          // deploy system contracts
          const evm = new EVM(vm, new TxContext(new BN(0), Address.zero()), block);
          await Contract.deploy(evm, nextCommon);

          systemCaller = Address.fromString(nextCommon.param('vm', 'scaddr'));
          parentRouter = new Router(evm, nextCommon);
          parentStakeManager = new StakeManager(evm, nextCommon);

          // stake for genesis validators
          const genesisValidators = getGenesisValidators(nextCommon);
          // TODO: config genesis validator voting power
          await rewardAccount(state, systemCaller, new BN(100).muln(genesisValidators.length));
          for (const genesisValidator of genesisValidators) {
            await parentStakeManager.stake(genesisValidator, new BN(100));
          }

          validatorSet = ValidatorSet.createGenesisValidatorSet(nextCommon, true);

          // start consensus engine
          this.getReimintEngine()?.start();
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

        // save `validatorSet` to `validatorSets`
        this.validatorSets.set(header.stateRoot, validatorSet);
      }
    },
    // if enable staking, we should use new run tx logic
    runTxOpts: { ...(enableStaking ? makeRunTxCallback(parentRouter!, systemCaller!, miner, header.timestamp.toNumber()) : undefined), ...options.runTxOpts }
  };

  const { block: newBlock } = await vm.runBlock(runBlockOptions);
  block = newBlock ? engine.getPendingBlock({ header: { ...newBlock.header }, transactions: [...newBlock.transactions] }) : block;
  header = block.header;
  logger.info('✨ Process block, height:', header.number.toString(), 'hash:', bufferToHex(block.hash()));
  const before = this.blockchain.latestBlock.hash();
  console.log('beforePutBlock:', block.header.extraData.toString('hex'), block.header.number.toNumber());
  await this.blockchain.putBlock(block);
  // persist receipts
  await this.db.batch(DBSaveTxLookup(block).concat(DBSaveReceipts(receipts, block.hash(), header.number)));
  const after = this.blockchain.latestBlock.hash();

  return {
    block,
    reorged: !before.equals(after)
  };
}
