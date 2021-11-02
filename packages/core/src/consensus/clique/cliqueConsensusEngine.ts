import { Address, bufferToHex, BN } from 'ethereumjs-util';
import VM from '@gxchain2-ethereumjs/vm';
import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import TxContext from '@gxchain2-ethereumjs/vm/dist/evm/txContext';
import { RunBlockOpts, rewardAccount } from '@gxchain2-ethereumjs/vm/dist/runBlock';
import { StateManager as IStateManager } from '@gxchain2-ethereumjs/vm/dist/state';
import { Block, HeaderData, Transaction } from '@gxchain2/structure';
import { Common } from '@gxchain2/common';
import { logger, nowTimestamp, getRandomIntInclusive } from '@gxchain2/utils';
import { ConsensusEngine, FinalizeOpts, ProcessBlockOpts, ProcessTxOptions } from '../types';
import { Contract, Router } from '../../contracts';
import { ValidatorSet } from '../../staking';
import { isEnableStaking } from '../../hardforks';
import { BaseConsensusEngine } from '../baseConsensusEngine';
import { getGasLimitByCommon } from '../utils';
import { Clique } from './clique';

const NoTurnSignerDelay = 500;

export class CliqueConsensusEngine extends BaseConsensusEngine implements ConsensusEngine {
  private nextTd?: BN;
  private timeout?: NodeJS.Timeout;

  protected _start() {}

  protected _abort() {
    return Promise.resolve();
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

    const parentHash = header.hash();
    const parentTD = await this.node.db.getTotalDifficulty(parentHash, header.number);
    // return if cancel failed
    if (!this.cancel(parentTD)) {
      return;
    }

    // check valid signer and recently sign
    const activeSigners = this.node.blockchain.cliqueActiveSignersByBlockNumber(header.number);
    const recentlyCheck = this.node.blockchain.cliqueCheckNextRecentlySigned(header, this.coinbase);
    if (!this.isValidSigner(activeSigners) || recentlyCheck) {
      return;
    }

    const [inTurn, difficulty] = Clique.calcCliqueDifficulty(activeSigners, this.coinbase, pendingBlock.number);
    const gasLimit = getGasLimitByCommon(pendingBlock.common);
    pendingBlock.complete(difficulty, gasLimit);

    if (this.timeout === undefined && this.nextTd === undefined) {
      // calculate timeout duration for next block
      const duration = this.calcTimeout(pendingBlock.timestamp, inTurn, activeSigners.length);
      this.nextTd = parentTD.add(difficulty);
      this.timeout = setTimeout(async () => {
        this.nextTd = undefined;
        this.timeout = undefined;

        try {
          // finalize pending block
          const { header: data, transactions } = await pendingBlock.finalize();
          const block = this.generatePendingBlock(data, pendingBlock.common, transactions);

          const reorged = await this.node.processBlock(block, {
            broadcast: true
          });
          if (reorged) {
            logger.info('⛏️  Mine block, height:', block.header.number.toString(), 'hash:', bufferToHex(block.hash()));
            // try to continue minting
            this.node.onMintBlock();
          }
        } catch (err) {
          logger.error('CliqueConsensusEngine::newBlockHeader, processBlock, catch error:', err);
        }
      }, duration);
    }
  }

  // cancel the timer if the total difficulty is greater than `this.nextTD`
  private cancel(nextTd: BN) {
    if (!this.nextTd) {
      return true;
    }
    if (this.nextTd.lte(nextTd)) {
      this.nextTd = undefined;
      if (this.timeout) {
        clearTimeout(this.timeout);
        this.timeout = undefined;
      }
      return true;
    }
    return false;
  }

  // calculate sleep duration
  private calcTimeout(nextBlockTimestamp: number, inTurn: boolean, activeSignerCount: number) {
    const now = nowTimestamp();
    let timeout = now > nextBlockTimestamp ? 0 : nextBlockTimestamp - now;
    timeout *= 1000;
    if (!inTurn) {
      timeout += getRandomIntInclusive(1, activeSignerCount + 1) * NoTurnSignerDelay;
    }
    return timeout;
  }

  // check if the local signer is included in `activeSigners`
  private isValidSigner(activeSigners: Address[]) {
    return activeSigners.filter((s) => s.equals(this.coinbase)).length > 0;
  }

  // try to get clique signer's private key,
  // return undefined if it is disable
  private cliqueSigner() {
    return this.enable && this.node.accMngr.hasUnlockedAccount(this.coinbase) ? this.node.accMngr.getPrivateKey(this.coinbase) : undefined;
  }

  ////////////////////////

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
    const nextCommon = this.node.getCommon(pendingBlock.header.number.addn(1));
    if (isEnableStaking(nextCommon)) {
      // deploy system contracts
      const evm = new EVM(vm, new TxContext(new BN(0), Address.zero()), pendingBlock);
      await Contract.deploy(evm, nextCommon);

      const parentRouter = new Router(evm, nextCommon);
      validatorSet = ValidatorSet.createGenesisValidatorSet(nextCommon);

      const activeValidators = validatorSet.activeValidators();
      const activeSigners = activeValidators.map(({ validator }) => validator);
      const priorities = activeValidators.map(({ priority }) => priority);
      // call after block callback to save active validators list
      await parentRouter!.onAfterBlock(activeSigners, priorities);

      // start consensus engine
      this.node.getReimintEngine()?.start();
    }

    return validatorSet;
  }

  /**
   * {@link ConsensusEngine.generatePendingBlock}
   */
  generatePendingBlock(headerData: HeaderData, common: Common, transactions?: Transaction[]) {
    return Block.fromBlockData({ header: headerData, transactions }, { common, cliqueSigner: this.cliqueSigner() });
  }

  /**
   * {@link ConsensusEngine.finalize}
   */
  async finalize(options: FinalizeOpts) {
    const { block, stateRoot, receipts, transactions } = options;

    const pendingCommon = block._common;
    const vm = await this.node.getVM(stateRoot, pendingCommon);

    const miner = Clique.getMiner(block);
    const minerReward = new BN(pendingCommon.param('pow', 'minerReward'));

    await vm.stateManager.checkpoint();
    try {
      await this.assignBlockReward(vm.stateManager, miner, minerReward);
      await this.afterApply(vm, block);
      const finalizedStateRoot = await vm.stateManager.getStateRoot();
      return {
        finalizedStateRoot,
        receiptTrie: await Clique.genReceiptTrie(transactions, receipts)
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
    const { block, root } = options;

    const miner = Clique.getMiner(block);
    const pendingHeader = block.header;
    const pendingCommon = block._common;

    const vm = await this.node.getVM(root, pendingCommon);

    if (!options.skipConsensusValidation) {
      Clique.consensusValidateHeader(pendingHeader, this.node.blockchain);
    }

    let validatorSet: ValidatorSet | undefined;
    const runBlockOptions: RunBlockOpts = {
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
    return { ...result, validatorSet };
  }

  /**
   * {@link ConsensusEngine.processTx}
   */
  processTx(options: ProcessTxOptions) {
    const { vm } = options;
    return vm.runTx(options);
  }
}
