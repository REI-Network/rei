import { Address, bufferToHex, BN } from 'ethereumjs-util';
import { Block, HeaderData, Transaction, Receipt } from '@rei-network/structure';
import { Common } from '@rei-network/common';
import { logger, nowTimestamp, getRandomIntInclusive } from '@rei-network/utils';
import { ConsensusEngine } from '../types';
import { BaseConsensusEngine } from '../baseConsensusEngine';
import { getGasLimitByCommon } from '../../utils';
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
    const activeSigners = await this.node.master.cliqueActiveSignersByBlockNumber(header.number);
    const recentlyCheck = await this.node.master.cliqueCheckNextRecentlySigned(header.number, this.coinbase);
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
          const result = await this.node.master.processBlock({ block });
          // commit pending block
          const reorged = await this.node.commitBlock({
            ...result,
            block,
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

  /**
   * {@link ConsensusEngine.generatePendingBlock}
   */
  generatePendingBlock(headerData: HeaderData, common: Common, transactions?: Transaction[]) {
    return Block.fromBlockData({ header: headerData, transactions }, { common, cliqueSigner: this.cliqueSigner() });
  }

  generateReceiptTrie(transactions: Transaction[], receipts: Receipt[]): Promise<Buffer> {
    return Clique.genReceiptTrie(receipts);
  }
}
