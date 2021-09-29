import { Address, bufferToHex, BN, KECCAK256_RLP_ARRAY } from 'ethereumjs-util';
import { Block, BlockHeader, BlockData, HeaderData, BlockBuffer, BlockHeaderBuffer, BlockOptions, preHF1CalcCliqueDifficulty, CLIQUE_DIFF_NOTURN } from '@gxchain2/structure';
import { Common } from '@gxchain2/common';
import { hexStringToBN, Channel, logger, nowTimestamp, getRandomIntInclusive } from '@gxchain2/utils';
import { ConsensusEngine } from '../consensusEngine';
import { Node } from '../../node';
import { Worker } from '../../worker';

const EMPTY_ADDRESS = Address.zero();
const noTurnSignerDelay = 500;

export interface CliqueConsensusEngineOptions {
  node: Node;
  enable: boolean;
  coinbase?: Address;
}

export class CliqueConsensusEngine implements ConsensusEngine {
  readonly worker: Worker;

  private node: Node;
  private msgQueue = new Channel<BlockHeader>({ max: 1 });
  private msgLoopPromise: Promise<void>;
  private initPromise: Promise<void>;

  private _enable: boolean;
  private _coinbase: Address;
  private nextTd?: BN;
  private timeout?: NodeJS.Timeout;

  constructor(options: CliqueConsensusEngineOptions) {
    this.node = options.node;
    this._enable = options.enable;
    this._coinbase = options.coinbase ?? EMPTY_ADDRESS;
    this.worker = new Worker({ node: this.node, ce: this });
    this.initPromise = this.init();
    this.msgLoopPromise = this.msgLoop();
  }

  private async msgLoop() {
    for await (const header of this.msgQueue.generator()) {
      try {
        await this._newBlockHeader(header);
      } catch (err) {
        logger.error('CliqueConsensusEngine::msgLoop, catch error:', err);
      }
    }
  }

  /**
   * Process a new block header, try to mint a block after this block
   * @param header - New block header
   */
  private async _newBlockHeader(header: BlockHeader) {
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

    // create a new pending block through worker
    await this.worker.newBlockHeader(header);
    let pendingBlock = await this.worker.getPendingBlockByParentHash(parentHash);
    if (!this.enable || this.node.sync.isSyncing) {
      return;
    }

    if (this.timeout === undefined && this.nextTd === undefined) {
      // calculate timeout duration for next block
      const duration = this.calcTimeout(pendingBlock.header.timestamp.toNumber(), !pendingBlock.header.difficulty.eq(CLIQUE_DIFF_NOTURN), activeSigners.length);
      this.nextTd = parentTD.add(pendingBlock.header.difficulty);
      this.timeout = setTimeout(async () => {
        this.nextTd = undefined;
        this.timeout = undefined;

        try {
          // get pending block by parent block hash again,
          // because the newest pending block may contain the newest transaction
          pendingBlock = await this.worker.getPendingBlockByParentHash(parentHash);

          const { reorged, block } = await this.node.processBlock(pendingBlock, {
            generate: true,
            broadcast: true
          });
          if (reorged) {
            logger.info('⛏️  Mine block, height:', block.header.number.toString(), 'hash:', bufferToHex(block.hash()));
            // try to continue mint
            if (this.enable && !this.node.sync.isSyncing) {
              this.newBlockHeader(this.node.blockchain.latestBlock.header);
            }
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
      timeout += getRandomIntInclusive(1, activeSignerCount + 1) * noTurnSignerDelay;
    }
    return timeout;
  }

  private isValidSigner(activeSigners: Address[]) {
    return activeSigners.filter((s) => s.equals(this.coinbase)).length > 0;
  }

  private cliqueSigner() {
    return this.enable ? this.node.accMngr.getPrivateKey(this.coinbase) : undefined;
  }

  get coinbase() {
    return this._coinbase;
  }

  get enable() {
    return this._enable && !this._coinbase.equals(EMPTY_ADDRESS) && this.node.accMngr.hasUnlockedAccount(this._coinbase);
  }

  newBlockHeader(header: BlockHeader) {
    this.msgQueue.push(header);
  }

  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    await this.worker.init();
    await this._newBlockHeader(this.node.blockchain.latestBlock.header);
  }

  async abort() {
    this.msgQueue.abort();
    await this.msgLoopPromise;
  }

  /**
   * {@link ConsensusEngine.BlockHeader_fromValuesArray}
   */
  BlockHeader_fromValuesArray(data: BlockHeaderBuffer, options?: BlockOptions) {
    return BlockHeader.fromValuesArray(data, { cliqueSigner: this.cliqueSigner(), ...options });
  }

  /**
   * {@link ConsensusEngine.BlockHeader_fromHeaderData}
   */
  BlockHeader_fromHeaderData(data: HeaderData, options?: BlockOptions) {
    return BlockHeader.fromHeaderData(data, { cliqueSigner: this.cliqueSigner(), ...options });
  }

  /**
   * {@link ConsensusEngine.Block_fromValuesArray}
   */
  Block_fromValuesArray(data: BlockBuffer, options?: BlockOptions) {
    return Block.fromValuesArray(data, { cliqueSigner: this.cliqueSigner(), ...options });
  }

  /**
   * {@link ConsensusEngine.Block_fromBlockData}
   */
  Block_fromBlockData(data: BlockData, options?: BlockOptions) {
    return Block.fromBlockData(data, { cliqueSigner: this.cliqueSigner(), ...options });
  }

  /**
   * {@link ConsensusEngine.getGasLimitByCommon}
   */
  getGasLimitByCommon(common: Common) {
    const limit = common.param('vm', 'gasLimit');
    return hexStringToBN(limit === null ? common.genesis().gasLimit : limit);
  }

  /**
   * {@link ConsensusEngine.getPendingBlockHeader}
   */
  getPendingBlockHeader({ parentHash, number, timestamp }: HeaderData) {
    if (number === undefined || !(number instanceof BN)) {
      throw new Error('invalid header data');
    }

    let difficulty: BN;
    const activeSigners = this.node.blockchain.cliqueActiveSignersByBlockNumber(number);
    if (this.isValidSigner(activeSigners)) {
      difficulty = preHF1CalcCliqueDifficulty(activeSigners, this.coinbase, number)[1];
    } else {
      difficulty = CLIQUE_DIFF_NOTURN.clone();
    }

    const common = this.node.getCommon(number);
    return this.BlockHeader_fromHeaderData(
      {
        parentHash,
        uncleHash: KECCAK256_RLP_ARRAY,
        coinbase: EMPTY_ADDRESS,
        number,
        timestamp,
        difficulty,
        gasLimit: this.getGasLimitByCommon(common)
      },
      { common }
    );
  }

  /**
   * {@link ConsensusEngine.getPendingBlock}
   */
  async getPendingBlock() {
    await this.initPromise;
    const pendingBlock = await this.worker.getLastPendingBlock();
    return pendingBlock ?? this.Block_fromBlockData({}, { common: this.node.getCommon(0) });
  }
}
