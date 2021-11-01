import { Address, bufferToHex, BN } from 'ethereumjs-util';
import VM from '@gxchain2-ethereumjs/vm';
import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import TxContext from '@gxchain2-ethereumjs/vm/dist/evm/txContext';
import { RunBlockOpts, rewardAccount } from '@gxchain2-ethereumjs/vm/dist/runBlock';
import { StateManager as IStateManager } from '@gxchain2-ethereumjs/vm/dist/state';
import { Block, HeaderData, Transaction } from '@gxchain2/structure';
import { Common } from '@gxchain2/common';
import { logger, nowTimestamp, getRandomIntInclusive } from '@gxchain2/utils';
import { ConsensusEngine, FinalizeOpts, ProcessBlockOpts, ProcessTxOptions } from '../consensusEngine';
import { Contract, Router } from '../../contracts';
import { ValidatorSet } from '../../staking';
import { isEnableStaking } from '../../hardforks';
import { ConsensusEngineBase } from '../consensusEngineBase';
import { getGasLimitByCommon } from '../utils';
import { Clique } from './clique';

const NoTurnSignerDelay = 500;

export class CliqueConsensusEngine extends ConsensusEngineBase implements ConsensusEngine {
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

  async assignBlockReward(state: IStateManager, miner: Address, reward: BN) {
    await rewardAccount(state, miner, reward);
  }

  async afterApply(vm: VM, pendingBlock: Block) {
    const pendingHeader = pendingBlock.header;
    let validatorSet: ValidatorSet | undefined;
    const nextCommon = this.node.getCommon(pendingHeader.number.addn(1));
    if (isEnableStaking(nextCommon)) {
      // deploy system contracts
      const evm = new EVM(vm, new TxContext(new BN(0), Address.zero()), pendingBlock);
      await Contract.deploy(evm, nextCommon);

      const parentRouter = new Router(evm, nextCommon);
      validatorSet = ValidatorSet.createGenesisValidatorSet(nextCommon);

      const activeValidators = validatorSet.activeValidators();
      logger.debug(
        'Clique::processBlock, activeValidators:',
        activeValidators.map(({ validator, priority }) => {
          return `address: ${validator.toString()} | priority: ${priority.toString()} | votingPower: ${validatorSet!.getVotingPower(validator).toString()}`;
        })
      );

      // proposer = validatorSet.proposer;
      const activeSigners = activeValidators.map(({ validator }) => validator);
      const priorities = activeValidators.map(({ priority }) => priority);
      // call after block callback to save active validators list
      await parentRouter!.onAfterBlock(activeSigners, priorities);

      // start consensus engine
      this.node.getReimintEngine()?.start();
    }

    return validatorSet;
  }

  generatePendingBlock(headerData: HeaderData, common: Common, transactions?: Transaction[]) {
    return Block.fromBlockData({ header: headerData, transactions }, { common, cliqueSigner: this.cliqueSigner() });
  }

  async finalize(options: FinalizeOpts) {
    const { block, stateRoot, receipts, transactions } = options;

    const pendingCommon = block._common;
    const vm = await this.node.getVM(stateRoot, pendingCommon);

    const miner = block.header.cliqueSigner();
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

  async processBlock(options: ProcessBlockOpts) {
    const { block } = options;
    const header = block.header;
    // ensure that every transaction is in the right common
    for (const tx of block.transactions) {
      tx.common.getHardforkByBlockNumber(header.number);
    }

    const miner = block.header.cliqueSigner();
    const pendingHeader = block.header;
    const pendingCommon = block._common;

    // get parent header
    const parent = await this.node.db.getHeader(pendingHeader.parentHash, pendingHeader.number.subn(1));
    const vm = await this.node.getVM(parent.stateRoot, pendingCommon);

    if (!options.skipConsensusValidation) {
      Clique.consensusValidateHeader.call(pendingHeader, this.node.blockchain);
    }

    let validatorSet: ValidatorSet | undefined; // TODO
    const runBlockOptions: RunBlockOpts = {
      generate: false,
      block,
      skipBlockValidation: true,
      root: parent.stateRoot,
      genReceiptTrie: Clique.genReceiptTrie,
      assignBlockReward: (state: IStateManager, reward: BN) => {
        return this.assignBlockReward(state, miner, reward);
      },
      afterApply: async () => {
        validatorSet = await this.afterApply(vm, block);
      }
    };

    return await vm.runBlock(runBlockOptions);
  }

  processTx(options: ProcessTxOptions) {
    const { vm } = options;
    return vm.runTx(options);
  }
}
