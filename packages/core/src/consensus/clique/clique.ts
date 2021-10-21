import { Address, bufferToHex, BN } from 'ethereumjs-util';
import { Block, BlockHeader, HeaderData, preHF1CalcCliqueDifficulty, Transaction } from '@gxchain2/structure';
import { Common } from '@gxchain2/common';
import { logger, nowTimestamp, getRandomIntInclusive } from '@gxchain2/utils';
import { ConsensusEngine } from '../consensusEngine';
import { ConsensusEngineBase } from '../consensusEngineBase';

const NoTurnSignerDelay = 500;

export class CliqueConsensusEngine extends ConsensusEngineBase implements ConsensusEngine {
  private nextTd?: BN;
  private timeout?: NodeJS.Timeout;

  /////////////////////////////////

  /**
   * {@link ConsensusEngine.getMiner}
   */
  getMiner(data: BlockHeader | Block) {
    return data instanceof Block ? data.header.cliqueSigner() : data.cliqueSigner();
  }

  /**
   * {@link ConsensusEngine.simpleSignBlock}
   */
  simpleSignBlock(data: HeaderData, common: Common, transactions?: Transaction[]) {
    const header = BlockHeader.fromHeaderData(data, { common, cliqueSigner: this.cliqueSigner() });
    return new Block(header, transactions, undefined, { common });
  }

  /////////////////////////////////

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

    const [inTurn, difficulty] = preHF1CalcCliqueDifficulty(activeSigners, this.coinbase, pendingBlock.number);
    const gasLimit = this.getGasLimitByCommon(pendingBlock.common);
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
          const { header: data, transactions } = await pendingBlock!.finalize();
          const block = this.simpleSignBlock(data, pendingBlock.common, transactions);

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
    return this.enable ? this.node.accMngr.getPrivateKey(this.coinbase) : undefined;
  }
}
