import { Address, BN, ecsign, intToBuffer } from 'ethereumjs-util';
import VM from '@gxchain2-ethereumjs/vm';
import { RunBlockOpts, rewardAccount } from '@gxchain2-ethereumjs/vm/dist/runBlock';
import { StateManager as IStateManager } from '@gxchain2-ethereumjs/vm/dist/state';
import { Block, HeaderData, Log, Receipt } from '@gxchain2/structure';
import { Common } from '@gxchain2/common';
import { logger } from '@gxchain2/utils';
import { StakeManager, Router } from '../../contracts';
import { ValidatorSet, ValidatorChanges } from '../../staking';
import { Node, ProcessBlockOptions } from '../../node';
import { ConsensusProtocol } from '../../protocols/consensus';
import { ConsensusEngine, ConsensusEngineOptions, FinalizeOpts, ProcessBlockOpts, ProcessTxOptions } from '../types';
import { isEmptyAddress, postByzantiumTxReceiptsToReceipts, getGasLimitByCommon } from '../utils';
import { BaseConsensusEngine } from '../baseConsensusEngine';
import { ExtraData, EvidencePool, EvidenceDatabase, Message } from './types';
import { StateMachine, SendMessageOptions } from './state';
import { Reimint } from './reimint';
import { makeRunTxCallback } from './makeRunTxCallback';

export class SimpleNodeSigner {
  readonly node: Node;

  constructor(node: Node) {
    this.node = node;
  }

  address(): Address {
    return this.node.getCurrentEngine().coinbase;
  }

  sign(msg: Buffer): Buffer {
    const coinbase = this.node.getCurrentEngine().coinbase;
    if (coinbase.equals(Address.zero())) {
      throw new Error('empty coinbase');
    }
    const signature = ecsign(msg, this.node.accMngr.getPrivateKey(coinbase));
    return Buffer.concat([signature.r, signature.s, intToBuffer(signature.v - 27)]);
  }
}

export class SimpleConfig {
  // TODO: config
  proposeDuration(round: number) {
    return 3000 + 500 * round;
  }

  prevoteDuration(round: number) {
    return 1000 + 500 * round;
  }

  precommitDutaion(round: number) {
    return 1000 + 500 * round;
  }
}

export class ReimintConsensusEngine extends BaseConsensusEngine implements ConsensusEngine {
  readonly state: StateMachine;
  readonly evpool: EvidencePool;
  readonly config: SimpleConfig = new SimpleConfig();
  readonly signer?: SimpleNodeSigner;

  constructor(options: ConsensusEngineOptions) {
    super(options);

    this.evpool = new EvidencePool(new EvidenceDatabase(options.node.evidencedb));

    if (!isEmptyAddress(this.coinbase) && this.node.accMngr.hasUnlockedAccount(this.coinbase)) {
      this.signer = new SimpleNodeSigner(this.node);
    }
    this.state = new StateMachine(this, this.evpool, this.node.getChainId(), this.config, this.signer);
  }

  protected _start() {
    logger.debug('ReimintConsensusEngine::_start');
    this.evpool.init(this.node.blockchain.latestBlock.header.number).catch((err) => {
      logger.error('ReimintConsensusEngine::_start, evpool init error:', err);
    });
    this.state.start();
  }

  protected async _abort() {
    await this.state.abort();
  }

  /**
   * Process a new block, try to mint a block after this block
   * @param block - New block
   */
  protected async _newBlock(block: Block) {
    const header = block.header;
    // create a new pending block through worker
    const pendingBlock = await this.worker.createPendingBlock(header);
    if (!this.enable || this.node.sync.isSyncing) {
      return;
    }

    const difficulty = new BN(1);
    const gasLimit = getGasLimitByCommon(pendingBlock.common);
    pendingBlock.complete(difficulty, gasLimit);

    let validators = this.node.validatorSets.directlyGet(header.stateRoot);
    // if the validator set doesn't exist, return
    if (!validators) {
      const vm = await this.node.getVM(header.stateRoot, header._common);
      validators = await this.node.validatorSets.get(header.stateRoot, this.node.getStakeManager(vm, block, this.node.getCommon(block.header.number.addn(1))));
    }

    this.state.newBlockHeader(header, validators, pendingBlock);
  }

  /**
   * Broadcast p2p message to remote peer
   * @param msg - Message
   * @param options - Send options {@link SendMessageOptions}
   */
  broadcastMessage(msg: Message, options: SendMessageOptions) {
    if (options.broadcast) {
      for (const handler of ConsensusProtocol.getPool().handlers) {
        handler.sendMessage(msg);
      }
    } else if (options.to) {
      const peer = this.node.networkMngr.getPeer(options.to);
      if (peer) {
        ConsensusProtocol.getHandler(peer, false)?.sendMessage(msg);
      }
    } else if (options.exclude) {
      for (const handler of ConsensusProtocol.getPool().handlers) {
        if (!options.exclude.includes(handler.peer.peerId)) {
          handler.sendMessage(msg);
        }
      }
    } else {
      throw new Error('invalid broadcast message options');
    }
  }

  /**
   * Execute single block
   * @param block - Block
   * @param options - Process block options
   * @returns Reorged
   */
  executeBlock(block: Block, options: ProcessBlockOptions) {
    return this.node.processBlock(block, options).then((reorged) => {
      if (reorged) {
        this.node.onMintBlock();
      }
      return reorged;
    });
  }

  /////////////////////////////

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
   * 2. collect all transaction logs
   * 3. merge validator changes to parent validator set
   * 4. call `Router.onAfterBlock`
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
  async afterApply(vm: VM, pendingBlock: Block, receipts: Receipt[], miner: Address, blockReward: BN, parentValidatorSet: ValidatorSet, parentStakeManager: StakeManager, parentRouter: Router) {
    const pendingCommon = pendingBlock._common;

    let logs: Log[] | undefined;
    const ethLogs = await parentRouter.assignBlockReward(miner, blockReward);
    if (ethLogs && ethLogs.length > 0) {
      logs = ethLogs.map((raw) => Log.fromValuesArray(raw));
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
    const activeSigners = activeValidators.map(({ validator }) => validator);
    const priorities = activeValidators.map(({ priority }) => priority);
    // call after block callback to save active validators list
    await parentRouter.onAfterBlock(activeSigners, priorities);
    return validatorSet;
  }

  /**
   * {@link ConsensusEngine.generatePendingBlock}
   */
  generatePendingBlock(headerData: HeaderData, common: Common) {
    const { block } = Reimint.generateBlockAndProposal(headerData, [], { common, signer: this.signer });
    return block;
  }

  /**
   * {@link ConsensusEngine.finalize}
   */
  async finalize(options: FinalizeOpts) {
    const { block, transactions, receipts, stateRoot, parentStateRoot, round } = options;
    if (round === undefined || !parentStateRoot) {
      throw new Error('missing state root');
    }

    const pendingCommon = block._common;
    const vm = await this.node.getVM(stateRoot, pendingCommon);

    const miner = Reimint.getMiner(block);
    const minerReward = new BN(pendingCommon.param('pow', 'minerReward'));
    const systemCaller = Address.fromString(pendingCommon.param('vm', 'scaddr'));
    const parentStakeManager = this.node.getStakeManager(vm, block);
    const parentRouter = this.node.getRouter(vm, block);
    const parentValidatorSet = (await this.node.validatorSets.get(parentStateRoot, parentStakeManager)).copy();
    parentValidatorSet.incrementProposerPriority(round);

    await vm.stateManager.checkpoint();
    try {
      await this.assignBlockReward(vm.stateManager, systemCaller, minerReward);
      await this.afterApply(vm, block, postByzantiumTxReceiptsToReceipts(receipts), miner, minerReward, parentValidatorSet, parentStakeManager, parentRouter);
      await vm.stateManager.commit();
      const finalizedStateRoot = await vm.stateManager.getStateRoot();
      return {
        finalizedStateRoot,
        receiptTrie: await Reimint.genReceiptTrie(transactions, receipts)
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
    const { block, root, runTxOpts } = options;

    const pendingHeader = block.header;
    const pendingCommon = block._common;

    const vm = await this.node.getVM(root, pendingCommon);

    const systemCaller = Address.fromString(pendingCommon.param('vm', 'scaddr'));
    const parentStakeManager = this.node.getStakeManager(vm, block);
    const parentRouter = this.node.getRouter(vm, block);
    let parentValidatorSet = await this.node.validatorSets.get(root, parentStakeManager);

    const extraData = ExtraData.fromBlockHeader(pendingHeader, { valSet: parentValidatorSet, increaseValSet: true });
    const miner = extraData.proposal.proposer();
    parentValidatorSet = extraData.validatorSet()!;

    if (!options.skipConsensusValidation) {
      extraData.validate();
    }

    let validatorSet!: ValidatorSet;
    const blockReward = new BN(0);
    const runBlockOptions: RunBlockOpts = {
      block,
      root,
      generate: false,
      skipBlockValidation: true,
      genReceiptTrie: Reimint.genReceiptTrie,
      assignBlockReward: async (state: IStateManager, reward: BN) => {
        await this.assignBlockReward(state, systemCaller, reward);
        blockReward.iadd(reward);
      },
      afterApply: async (state, { receipts: postByzantiumTxReceipts }) => {
        const receipts = postByzantiumTxReceiptsToReceipts(postByzantiumTxReceipts);
        validatorSet = await this.afterApply(vm, block, receipts, miner, blockReward, parentValidatorSet, parentStakeManager, parentRouter);
      },
      runTxOpts: { ...runTxOpts, ...makeRunTxCallback(parentRouter, systemCaller, miner, pendingHeader.timestamp.toNumber()) }
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
    return { ...result, validatorSet };
  }

  /**
   * {@link ConsensusEngine.processTx}
   */
  processTx(options: ProcessTxOptions) {
    const { vm, block } = options;
    const systemCaller = Address.fromString(block._common.param('vm', 'scaddr'));
    const router = this.node.getRouter(vm, block);
    return vm.runTx({
      ...options,
      skipBalance: true,
      ...makeRunTxCallback(router, systemCaller, Reimint.getMiner(block), block.header.timestamp.toNumber())
    });
  }
}
