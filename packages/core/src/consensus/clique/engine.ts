import { Address, bufferToHex, BN, toBuffer } from 'ethereumjs-util';
import { BaseTrie, SecureTrie as Trie } from 'merkle-patricia-tree';
import { Block, BlockHeader, HeaderData, Transaction, Receipt } from '@rei-network/structure';
import { Common } from '@rei-network/common';
import { genesisStateByName } from '@rei-network/common/dist/genesisStates';
import { logger, nowTimestamp, getRandomIntInclusive } from '@rei-network/utils';
import { ConsensusEngine, ConsensusEngineOptions } from '../types';
import { BaseConsensusEngine } from '../engine';
import { getGasLimitByCommon } from '../../utils';
import { StateManager } from '../../stateManager';
import { Clique } from './clique';
import { CliqueExecutor } from './executor';

const NoTurnSignerDelay = 500;

export class CliqueConsensusEngine extends BaseConsensusEngine implements ConsensusEngine {
  readonly executor: CliqueExecutor;

  private nextTd?: BN;
  private timeout?: NodeJS.Timeout;

  constructor(options: ConsensusEngineOptions) {
    super(options);
    this.executor = new CliqueExecutor(this.node);
  }

  /**
   * {@link ConsensusEngine.init}
   */
  async init() {}

  protected _start() {
    logger.debug('CliqueConsensusEngine::start');
  }

  protected _abort() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
    return Promise.resolve();
  }

  /**
   * Try to mint a block after this block
   * @param block - New block
   */
  protected async _tryToMintNextBlock(block: Block) {
    const header = block.header;
    // create a new pending block through worker
    const pendingBlock = await this.worker.createPendingBlock(header);
    if (!this.enable) {
      return;
    }

    const parentHash = header.hash();
    const parentTD = await this.node.db.getTotalDifficulty(parentHash, header.number);
    // return if cancel failed
    if (!this.cancel(parentTD)) {
      return;
    }

    // check valid signer and recently sign
    const activeSigners = await this.node.blockchain.cliqueActiveSignersByBlockNumber(header.number);
    const recentlyCheck = await this.node.blockchain.cliqueCheckNextRecentlySigned(header, this.coinbase);
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
          // process pending block
          const result = await this.executor.processBlock({ block });
          // commit pending block
          const reorged = await this.node.commitBlock({
            receipts: result.receipts,
            block,
            broadcast: true
          });
          if (reorged) {
            logger.info('⛏️  Mint block, height:', block.header.number.toString(), 'hash:', bufferToHex(block.hash()));
            // try to continue minting
            this.node.tryToMintNextBlock();
          }
        } catch (err: any) {
          if (err.message === 'committed' || err.message === 'aborted') {
            // ignore errors...
          } else {
            logger.error('CliqueConsensusEngine::newBlockHeader, processBlock, catch error:', err);
          }
        }
      }, duration);
    }
  }

  /**
   * {@link ConsensusEngine.newBlock}
   */
  async newBlock(block: Block) {}

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

  /**
   * {@link ConsensusEngine.generateGenesis}
   */
  async generateGenesis() {
    const common = this.node.getCommon(0);
    const genesisBlock = Block.fromBlockData({ header: common.genesis() }, { common });
    const stateManager = new StateManager({ common, trie: new Trie(this.node.chaindb) });
    await stateManager.generateGenesis(genesisStateByName(this.node.chain));
    const root = await stateManager.getStateRoot();

    if (!root.equals(genesisBlock.header.stateRoot)) {
      logger.error('State root not equal', bufferToHex(root), bufferToHex(genesisBlock.header.stateRoot));
      throw new Error('state root not equal');
    }
  }

  /**
   * {@link ConsensusEngine.getMiner}
   */
  getMiner(data: Block | BlockHeader) {
    return Clique.getMiner(data);
  }

  /**
   * {@link ConsensusEngine.generatePendingBlock}
   */
  generatePendingBlock(headerData: HeaderData, common: Common, transactions?: Transaction[]) {
    return Block.fromBlockData({ header: headerData, transactions }, { common, cliqueSigner: this.cliqueSigner() });
  }

  /**
   * {@link ConsensusEngine.generateReceiptTrie}
   */
  async generateReceiptTrie(transactions: Transaction[], receipts: Receipt[]): Promise<Buffer> {
    const trie = new BaseTrie();
    for (let i = 0; i < receipts.length; i++) {
      await trie.put(toBuffer(i), receipts[i].serialize());
    }
    return trie.root;
  }
}
