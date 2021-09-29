import { Address, bufferToHex, BN } from 'ethereumjs-util';
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

  private async _newBlockHeader(header: BlockHeader) {
    if (!this.enable || this.node.sync.isSyncing) {
      return;
    }

    const parentHash = header.hash();
    const parentTD = await this.node.db.getTotalDifficulty(parentHash, header.number);
    this.cancel(parentTD);

    const activeSigners = this.node.blockchain.cliqueActiveSignersByBlockNumber(header.number);
    const recentlyCheck = this.node.blockchain.cliqueCheckNextRecentlySigned(header, this.coinbase);
    if (!this.isValidSigner(activeSigners) || recentlyCheck) {
      return;
    }

    await this.worker.newBlockHeader(header);
    const pendingTxs = await this.worker.getPendingTxsByParentHash(parentHash);
    if (!this.enable || this.node.sync.isSyncing) {
      return;
    }

    const pendingNumber = header.number.addn(1);
    const [inTurn, difficulty] = preHF1CalcCliqueDifficulty(activeSigners, this.coinbase, pendingNumber);
    const period: number = header._common.consensusConfig().period;
    const timestamp = header.timestamp.toNumber() + period;
    const pendingCommon = this.node.getCommon(pendingNumber);

    this.nextTd = parentTD.add(difficulty);
    this.timeout = setTimeout(() => {
      this.nextTd = undefined;
      this.timeout = undefined;

      const now = nowTimestamp();
      const pendingBlock = this.Block_fromBlockData(
        {
          header: {
            parentHash,
            difficulty,
            number: pendingNumber,
            gasLimit: this.getGasLimitByCommon(pendingCommon),
            timestamp: now > timestamp ? now : timestamp
          },
          transactions: pendingTxs
        },
        { common: pendingCommon, hardforkByBlockNumber: true }
      );

      this.node
        .processBlock(pendingBlock, {
          generate: true,
          broadcast: true
        })
        .then(({ reorged, block }) => {
          if (reorged) {
            logger.info('⛏️  Mine block, height:', block.header.number.toString(), 'hash:', bufferToHex(block.hash()));
            // try to continue mint
            if (this.enable && !this.node.sync.isSyncing) {
              this.newBlockHeader(this.node.blockchain.latestBlock.header);
            }
          }
        })
        .catch((err) => {
          logger.error('CliqueConsensusEngine::newBlockHeader, processBlock, catch error:', err);
        });
    }, this.calcTimeout(timestamp, inTurn, activeSigners.length));
  }

  private cancel(nextTd: BN) {
    if (this.nextTd && this.nextTd.lte(nextTd)) {
      this.nextTd = undefined;
      if (this.timeout) {
        clearTimeout(this.timeout);
        this.timeout = undefined;
      }
    }
  }

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

  BlockHeader_fromValuesArray(data: BlockHeaderBuffer, options?: BlockOptions) {
    return BlockHeader.fromValuesArray(data, { cliqueSigner: this.cliqueSigner(), ...options });
  }

  BlockHeader_fromHeaderData(data: HeaderData, options?: BlockOptions) {
    return BlockHeader.fromHeaderData(data, { cliqueSigner: this.cliqueSigner(), ...options });
  }

  Block_fromValuesArray(data: BlockBuffer, options?: BlockOptions) {
    return Block.fromValuesArray(data, { cliqueSigner: this.cliqueSigner(), ...options });
  }

  Block_fromBlockData(data: BlockData, options?: BlockOptions) {
    return Block.fromBlockData(data, { cliqueSigner: this.cliqueSigner(), ...options });
  }

  getGasLimitByCommon(common: Common) {
    const limit = common.param('vm', 'gasLimit');
    return hexStringToBN(limit === null ? common.genesis().gasLimit : limit);
  }

  async getPendingBlock() {
    const { header } = this.node.blockchain.latestBlock;
    const parentHash = header.hash();
    const period: number = header._common.consensusConfig().period;
    const timestamp = header.timestamp.toNumber() + period;
    const pendingNumber = header.number.addn(1);
    const pendingCommon = this.node.getCommon(pendingNumber);
    const now = nowTimestamp();

    let difficulty: BN;
    const activeSigners = this.node.blockchain.cliqueActiveSignersByBlockNumber(header.number);
    if (this.isValidSigner(activeSigners)) {
      difficulty = preHF1CalcCliqueDifficulty(activeSigners, this.coinbase, header.number)[1];
    } else {
      difficulty = CLIQUE_DIFF_NOTURN.clone();
    }

    try {
      await this.worker.newBlockHeader(header);
      const pendingTxs = await this.worker.getPendingTxsByParentHash(parentHash);

      return this.Block_fromBlockData(
        {
          header: {
            parentHash,
            difficulty,
            number: pendingNumber,
            gasLimit: this.getGasLimitByCommon(pendingCommon),
            timestamp: now > timestamp ? now : timestamp
          },
          transactions: pendingTxs
        },
        { common: pendingCommon, hardforkByBlockNumber: true }
      );
    } catch (err) {
      logger.debug('CliqueConsensusEngine::getPendingBlock, catch error:', err);
      return this.Block_fromBlockData(
        {
          header: {
            parentHash,
            difficulty,
            number: pendingNumber,
            gasLimit: this.getGasLimitByCommon(pendingCommon),
            timestamp: now > timestamp ? now : timestamp
          },
          transactions: []
        },
        { common: pendingCommon, hardforkByBlockNumber: true }
      );
    }
  }
}
