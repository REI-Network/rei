import { Address, BN, bufferToHex, KECCAK256_RLP_ARRAY } from 'ethereumjs-util';
import Semaphore from 'semaphore-async-await';
import { Block, BlockHeader, preHF1CalcCliqueDifficulty, calcCliqueDifficulty, CLIQUE_DIFF_NOTURN, Transaction } from '@gxchain2/structure';
import VM from '@gxchain2-ethereumjs/vm';
import { DefaultStateManager as StateManager } from '@gxchain2-ethereumjs/vm/dist/state';
import { RunTxResult } from '@gxchain2-ethereumjs/vm/dist/runTx';
import { Common } from '@gxchain2/common';
import { logger, getRandomIntInclusive, hexStringToBN, nowTimestamp } from '@gxchain2/utils';
import { PendingTxMap } from '../txpool';
import { Node } from '../node';
import { isEnableStaking } from '../hardforks';

const noTurnSignerDelay = 500;
const maxHistoryLength = 10;

export interface MinerOptions {
  node: Node;
  enable: boolean;
  coinbase?: string;
}

/**
 * Miner creates blocks and searches for proof-of-work values.
 */
export class Miner {
  private readonly node: Node;
  private readonly initPromise: Promise<void>;

  private enable: boolean;
  private _coinbase: Address;
  private vm!: VM;
  private pendingTxs: Transaction[] = [];
  private pendingHeader!: BlockHeader;
  private gasUsed = new BN(0);
  private lock = new Semaphore(1);
  private timeout?: NodeJS.Timeout;
  private nextTd?: BN;
  private history: Block[] = [];

  constructor(options: MinerOptions) {
    this.node = options.node;
    this.enable = options.enable;
    this._coinbase = options.coinbase ? Address.fromString(options.coinbase) : Address.zero();
    this.initPromise = this.init();
  }

  /**
   * Get the mining state
   */
  get isMining() {
    return !this._coinbase.equals(Address.zero()) && this.enable;
  }

  /**
   * Get the coinbase
   */
  get coinbase() {
    return this._coinbase;
  }

  /**
   * Get current block gas limit
   */
  get currentGasLimit() {
    return this.pendingHeader.gasLimit.clone();
  }

  /**
   * Set the coinbase
   * @param coinbase
   */
  async setCoinbase(coinbase: Address) {
    try {
      await this.lock.acquire();
      this.node.accMngr.getPrivateKey(coinbase);
      this._coinbase = coinbase;
    } catch (err) {
    } finally {
      this.lock.release();
    }
  }

  private _isValidSigner(signer: Address, activeSigners: Address[]) {
    return activeSigners.filter((s) => s.equals(signer)).length > 0;
  }

  private _shouldMintNextBlock(currentHeader: BlockHeader) {
    return this.isMining && !this.node.sync.isSyncing && !this.node.blockchain.cliqueCheckNextRecentlySigned(currentHeader, this.coinbase);
  }

  private _pushToHistory(block: Block) {
    this.history.push(block);
    if (this.history.length > maxHistoryLength) {
      this.history.shift();
    }
  }

  private async _getPendingBlockByParentHash(parentHash: Buffer) {
    const current = await this.getPendingBlock();
    if (current.header.parentHash.equals(parentHash)) {
      return current;
    }
    for (const b of this.history) {
      if (b.header.parentHash.equals(parentHash)) {
        return b;
      }
    }
  }

  private async _getActiveSigersByBlock(block: Block): Promise<{
    activeSigners: Address[];
    proposer?: Address;
  }> {
    const header = block.header;
    const common = header._common;
    let activeSigners: Address[];
    if (isEnableStaking(common)) {
      const vm = await this.node.getVM(header.stateRoot, common);
      const validatorSet = await this.node.validatorSets.get(header.stateRoot, this.node.getStakeManager(vm, block));
      activeSigners = validatorSet.activeSigners();
      return { activeSigners: validatorSet.activeSigners(), proposer: validatorSet.proposer() };
    } else {
      activeSigners = this.node.blockchain.cliqueActiveSignersByBlockNumber(header.number);
      return { activeSigners };
    }
  }

  private _calcCliqueDifficulty(activeSigners: Address[], common: Common, { proposer, number }: { proposer?: Address; number?: BN }) {
    if (!isEnableStaking(common)) {
      if (!number) {
        throw new Error('missing number information');
      }
      return preHF1CalcCliqueDifficulty(activeSigners, this.coinbase, number);
    } else {
      if (!proposer) {
        throw new Error('missing proposer information');
      }
      return calcCliqueDifficulty(activeSigners, this.coinbase, proposer);
    }
  }

  /**
   * Initialize the miner
   * @returns
   */
  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    const { activeSigners, proposer } = await this._getActiveSigersByBlock(this.node.blockchain.latestBlock);
    logger.debug(
      'Miner::init, activeSigners:',
      activeSigners.map((a) => a.toString())
    );
    await this._newBlockHeader(this.node.blockchain.latestBlock.header, activeSigners, proposer);
  }

  /**
   * Assembles the new block
   * @param header
   */
  async newBlockHeader(header: BlockHeader, activeSigners: Address[], proposer?: Address) {
    await this.initPromise;
    await this._newBlockHeader(header, activeSigners, proposer);
  }

  async startMint(block: Block) {
    await this.initPromise;
    await this._startMint(block);
  }

  private makeHeader(timestamp: number, parentHash: Buffer, parentCommon: Common, number: BN, activeSigners: Address[], proposer?: Address): { inTurn: boolean; validSigner: boolean; header: BlockHeader } {
    const common = this.node.getCommon(number);
    const gasLimit = hexStringToBN(common.param('gasConfig', 'gasLimit'));
    const validSigner = this._isValidSigner(this.coinbase, activeSigners);
    if (this.isMining && validSigner) {
      const [inTurn, difficulty] = this._calcCliqueDifficulty(activeSigners, parentCommon, { number, proposer });
      const header = BlockHeader.fromHeaderData(
        {
          // coinbase is always zero
          coinbase: Address.zero(),
          difficulty,
          gasLimit,
          // nonce is always zero
          nonce: Buffer.alloc(8),
          number,
          parentHash,
          timestamp,
          uncleHash: KECCAK256_RLP_ARRAY
        },
        { common, cliqueSigner: this.node.accMngr.getPrivateKey(this.coinbase) }
      );
      return { inTurn, header, validSigner };
    } else {
      const header = BlockHeader.fromHeaderData(
        {
          // coinbase is always zero
          coinbase: Address.zero(),
          difficulty: CLIQUE_DIFF_NOTURN.clone(),
          gasLimit,
          // nonce is always zero
          nonce: Buffer.alloc(8),
          number,
          parentHash,
          timestamp,
          uncleHash: KECCAK256_RLP_ARRAY
        },
        { common }
      );
      return { inTurn: false, header, validSigner };
    }
  }

  private async _newBlockHeader(header: BlockHeader, activeSigners: Address[], proposer?: Address) {
    try {
      await this.lock.acquire();
      if (this.vm) {
        await this.vm.stateManager.revert();
      }

      if (this.pendingHeader !== undefined && this.pendingHeader.number.gtn(0)) {
        this._pushToHistory(await this.getPendingBlock());
      }

      this.pendingTxs = [];
      this.gasUsed = new BN(0);
      const newNumber = header.number.addn(1);
      const period: number = header._common.consensusConfig().period;
      const timestamp = header.timestamp.toNumber() + period;
      const now = nowTimestamp();
      const { inTurn, header: newHeader, validSigner } = this.makeHeader(now > timestamp ? now : timestamp, header.hash(), header._common, newNumber, activeSigners, proposer);
      this.pendingHeader = newHeader;
      const currentTd = await this.node.db.getTotalDifficulty(header.hash(), header.number);
      const nextTd = currentTd.add(newHeader.difficulty);

      this._cancel(nextTd);
      this.vm = await this.node.getVM(header.stateRoot, newNumber);
      await this.vm.stateManager.checkpoint();
      await this._commit(await this.node.txPool.getPendingTxMap(header.number, header.hash()));
      if (validSigner && this._shouldMintNextBlock(header)) {
        this.nextTd = nextTd.clone();
        this._mint(header.hash(), this._calcTimeout(timestamp, inTurn, activeSigners.length));
      }
    } catch (err) {
      logger.error('Miner::_newBlock, catch error:', err);
    } finally {
      this.lock.release();
    }
  }

  private async _startMint(block: Block) {
    try {
      const header = block.header;
      await this.lock.acquire();

      if (!header.hash().equals(this.pendingHeader.parentHash)) {
        return;
      }

      const newNumber = header.number.addn(1);
      const period: number = header._common.consensusConfig().period;
      const timestamp = header.timestamp.toNumber() + period;
      const { activeSigners, proposer } = await this._getActiveSigersByBlock(block);
      const [inTurn, difficulty] = this._calcCliqueDifficulty(activeSigners, header._common, { number: newNumber, proposer });
      const currentTd = await this.node.db.getTotalDifficulty(header.hash(), header.number);
      const nextTd = currentTd.add(difficulty);

      this._cancel(nextTd);
      if (this._shouldMintNextBlock(header)) {
        this.nextTd = nextTd.clone();
        this._mint(header.hash(), this._calcTimeout(timestamp, inTurn, activeSigners.length));
      }
    } catch (err) {
      logger.error('Miner::_startMint, catch error:', err);
    } finally {
      this.lock.release();
    }
  }

  private _cancel(nextTd: BN) {
    if (this.isMining) {
      if (this.nextTd && this.nextTd.lte(nextTd)) {
        this.nextTd = undefined;
        if (this.timeout) {
          clearTimeout(this.timeout);
          this.timeout = undefined;
        }
      }
    }
  }

  private _calcTimeout(nextBlockTimestamp: number, inTurn: boolean, activeSignerCount: number) {
    const now = nowTimestamp();
    let timeout = now > nextBlockTimestamp ? 0 : nextBlockTimestamp - now;
    timeout *= 1000;
    if (!inTurn) {
      timeout += getRandomIntInclusive(1, activeSignerCount + 1) * noTurnSignerDelay;
    }
    return timeout;
  }

  private _updateTimestamp(block: Block, timestamp: number) {
    return block.header.timestamp.toNumber() >= timestamp
      ? block
      : Block.fromBlockData(
          {
            header: {
              ...block.header,
              timestamp
            },
            transactions: [...block.transactions]
          },
          { common: this.node.getCommon(block.header.number), cliqueSigner: this.isMining ? this.node.accMngr.getPrivateKey(this.coinbase) : undefined }
        );
  }

  private _mint(parentHash: Buffer, timeout: number) {
    this.timeout = setTimeout(async () => {
      let pendingBlock: Block | undefined;
      try {
        await this.lock.acquire();
        pendingBlock = await this._getPendingBlockByParentHash(parentHash);
        if (!pendingBlock) {
          throw new Error(`Missing pending block, parentHash: ${bufferToHex(parentHash)}`);
        }
        pendingBlock = this._updateTimestamp(pendingBlock, nowTimestamp());
      } catch (err) {
        logger.error('Miner::_mint, setTimeout, catch error:', err);
        return;
      } finally {
        this.lock.release();
      }
      this.node
        .processBlock(pendingBlock, { generate: true, broadcast: true })
        .then((newBlock) => {
          logger.info('⛏️  Mine block, height:', newBlock.header.number.toString(), 'hash:', bufferToHex(newBlock.hash()));
        })
        .catch((err) => {
          logger.error('Miner::_mint, setTimeout, catch error:', err);
        });
    }, timeout);
  }

  /**
   * Add transactions for commit
   * @param txs - The map of Buffer and array of transactions
   */
  async addTxs(txs: Map<Buffer, Transaction[]>) {
    await this.initPromise;
    try {
      await this.lock.acquire();
      const pendingMap = new PendingTxMap();
      for (const [sender, sortedTxs] of txs) {
        pendingMap.push(sender, sortedTxs);
      }
      await this._commit(pendingMap);
    } catch (err) {
      logger.error('Miner::addTxs, catch error:', err);
    } finally {
      this.lock.release();
    }
  }

  /**
   * Assembles the pending block from block data
   * @returns
   */
  async getPendingBlock() {
    await this.initPromise;
    return Block.fromBlockData(
      {
        header: { ...this.pendingHeader },
        transactions: [...this.pendingTxs]
      },
      { common: this.pendingHeader._common, hardforkByBlockNumber: true }
    );
  }

  async getPendingStateManager() {
    await this.initPromise;
    if (this.vm) {
      const stateManager: any = this.vm.stateManager;
      return new StateManager({ common: stateManager._common, trie: stateManager._trie.copy(false) });
    }
    return await this.node.getStateManager(this.node.blockchain.latestBlock.header.stateRoot, this.node.blockchain.latestHeight);
  }

  /**
   * Pack different pending block headers according to whether the node produces blocks
   * @param tx
   */
  private async _putTx(tx: Transaction) {
    this.pendingTxs.push(tx);
  }

  /**
   * _commit runs any post-transaction state modifications,
   * check whether the fees of all transactions exceed the standard
   * @param pendingMap All pending transactions
   */
  private async _commit(pendingMap: PendingTxMap) {
    let tx = pendingMap.peek();
    while (tx) {
      try {
        await this.vm.stateManager.checkpoint();

        let txRes: RunTxResult;
        tx.common.setHardforkByBlockNumber(this.pendingHeader.number);
        try {
          txRes = await this.vm.runTx({
            tx,
            block: Block.fromBlockData({ header: this.pendingHeader }, { common: (this.vm.stateManager as any)._common }),
            skipBalance: false,
            skipNonce: false
          });
        } catch (err) {
          await this.vm.stateManager.revert();
          pendingMap.pop();
          tx = pendingMap.peek();
          continue;
        }

        if (this.pendingHeader.gasLimit.lt(txRes.gasUsed.add(this.gasUsed))) {
          await this.vm.stateManager.revert();
          pendingMap.pop();
        } else {
          await this.vm.stateManager.commit();
          await this._putTx(tx);
          this.gasUsed.iadd(txRes.gasUsed);
          pendingMap.shift();
        }
      } catch (err) {
        pendingMap.pop();
      } finally {
        tx = pendingMap.peek();
      }
    }
  }
}
