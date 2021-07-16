import { Address, BN, bufferToHex } from 'ethereumjs-util';
import Semaphore from 'semaphore-async-await';
import { Block, BlockHeader, calcCliqueDifficulty, CLIQUE_DIFF_NOTURN, calculateTransactionTrie, Transaction } from '@gxchain2/structure';
import { WrappedVM } from '@gxchain2/vm';
import { logger, getRandomIntInclusive, hexStringToBN, nowTimestamp } from '@gxchain2/utils';
import { StateManager } from '@gxchain2/vm';
import { RunTxResult } from '@ethereumjs/vm/dist/runTx';
import { PendingTxMap } from '../txpool';
import { Node } from '../node';

const emptyUncleHash = '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347';
const noTurnSignerDelay = 500;
const maxHistoryLength = 10;
const defaultGasLimit = hexStringToBN('0xf4240');

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
  private _gasLimit: BN;
  private wvm!: WrappedVM;
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
    this._gasLimit = defaultGasLimit.clone();
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
   * Get the limit of gas
   */
  get gasLimit() {
    return this._gasLimit.clone();
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

  /**
   * Set the gas limit
   * @param gasLimit
   */
  setGasLimit(gasLimit: BN) {
    this._gasLimit = gasLimit.clone();
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

  /**
   * Initialize the miner
   * @returns
   */
  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    await this._newBlockHeader(this.node.blockchain.latestBlock.header);
  }

  /**
   * Assembles the new block
   * @param header
   */
  async newBlockHeader(header: BlockHeader) {
    await this.initPromise;
    await this._newBlockHeader(header);
  }

  async startMint(header: BlockHeader) {
    await this.initPromise;
    await this._startMint(header);
  }

  private makeHeader(timestamp: number, parentHash: Buffer, number: BN): [boolean, BlockHeader] {
    if (this.isMining) {
      const [inTurn, difficulty] = calcCliqueDifficulty(this.node.blockchain.cliqueActiveSigners(), this.coinbase, number);
      const header = BlockHeader.fromHeaderData(
        {
          // TODO: add beneficiary.
          coinbase: Address.zero(),
          difficulty,
          gasLimit: this.gasLimit,
          // TODO: add beneficiary.
          nonce: Buffer.alloc(8),
          number,
          parentHash,
          timestamp,
          uncleHash: emptyUncleHash
        },
        { common: this.node.getCommon(number), cliqueSigner: this.node.accMngr.getPrivateKey(this.coinbase) }
      );
      return [inTurn, header];
    } else {
      const header = BlockHeader.fromHeaderData(
        {
          coinbase: Address.zero(),
          difficulty: CLIQUE_DIFF_NOTURN.clone(),
          gasLimit: this.gasLimit,
          nonce: Buffer.alloc(8),
          number,
          parentHash,
          timestamp,
          uncleHash: emptyUncleHash
        },
        { common: this.node.getCommon(number) }
      );
      return [false, header];
    }
  }

  private async _newBlockHeader(header: BlockHeader) {
    try {
      await this.lock.acquire();
      if (this.wvm) {
        await this.wvm.vm.stateManager.revert();
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
      const [inTurn, newHeader] = this.makeHeader(now > timestamp ? now : timestamp, header.hash(), newNumber);
      this.pendingHeader = newHeader;
      const currentTd = await this.node.db.getTotalDifficulty(header.hash(), header.number);
      const nextTd = currentTd.add(newHeader.difficulty);

      this._cancel(nextTd);
      this.wvm = await this.node.getWrappedVM(header.stateRoot, newNumber);
      await this.wvm.vm.stateManager.checkpoint();
      await this._commit(await this.node.txPool.getPendingTxMap(header.number, header.hash()));
      if (this._shouldMintNextBlock(header)) {
        this.nextTd = nextTd.clone();
        this._mint(header.hash(), this._calcTimeout(timestamp, inTurn));
      }
    } catch (err) {
      logger.error('Miner::_newBlock, catch error:', err);
    } finally {
      this.lock.release();
    }
  }

  private async _startMint(header: BlockHeader) {
    try {
      await this.lock.acquire();

      if (!header.hash().equals(this.pendingHeader.parentHash)) {
        return;
      }

      const newNumber = header.number.addn(1);
      const period: number = header._common.consensusConfig().period;
      const timestamp = header.timestamp.toNumber() + period;
      const [inTurn, difficulty] = calcCliqueDifficulty(this.node.blockchain.cliqueActiveSigners(), this.coinbase, newNumber);
      const currentTd = await this.node.db.getTotalDifficulty(header.hash(), header.number);
      const nextTd = currentTd.add(difficulty);

      this._cancel(nextTd);
      if (this._shouldMintNextBlock(header)) {
        this.nextTd = nextTd.clone();
        this._mint(header.hash(), this._calcTimeout(timestamp, inTurn));
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

  private _calcTimeout(nextBlockTimestamp: number, inTurn: boolean) {
    const now = nowTimestamp();
    let timeout = now > nextBlockTimestamp ? 0 : nextBlockTimestamp - now;
    timeout *= 1000;
    if (!inTurn) {
      const signerCount = this.node.blockchain.cliqueActiveSigners().length;
      timeout += getRandomIntInclusive(1, signerCount + 1) * noTurnSignerDelay;
    }
    return timeout;
  }

  private _updateTimestamp(block: Block, timestamp: number) {
    return block.header.timestamp.toNumber() === timestamp
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
    if (this.wvm) {
      const stateManager: any = this.wvm.vm.stateManager;
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
    const txs = [...this.pendingTxs];
    const header = { ...this.pendingHeader };
    if (this.isMining) {
      this.pendingHeader = BlockHeader.fromHeaderData(
        {
          ...header,
          transactionsTrie: await calculateTransactionTrie(txs)
        },
        { common: header._common, cliqueSigner: this.node.accMngr.getPrivateKey(this.coinbase) }
      );
    } else {
      this.pendingHeader = BlockHeader.fromHeaderData(
        {
          ...header,
          transactionsTrie: await calculateTransactionTrie(txs)
        },
        { common: header._common }
      );
    }
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
        await this.wvm.vm.stateManager.checkpoint();

        let txRes: RunTxResult;
        tx.common.setHardforkByBlockNumber(this.pendingHeader.number);
        try {
          txRes = await this.wvm.vm.runTx({
            tx,
            block: Block.fromBlockData({ header: this.pendingHeader }, { common: (this.wvm.vm.stateManager as any)._common }),
            skipBalance: false,
            skipNonce: false
          });
        } catch (err) {
          await this.wvm.vm.stateManager.revert();
          pendingMap.pop();
          tx = pendingMap.peek();
          continue;
        }

        if (this.pendingHeader.gasLimit.lt(txRes.gasUsed.add(this.gasUsed))) {
          await this.wvm.vm.stateManager.revert();
          pendingMap.pop();
        } else {
          await this.wvm.vm.stateManager.commit();
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
