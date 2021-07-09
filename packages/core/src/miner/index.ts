import { Address, BN, bufferToHex } from 'ethereumjs-util';
import Semaphore from 'semaphore-async-await';
import { Block, BlockHeader, calcCliqueDifficulty, CLIQUE_DIFF_NOTURN, calculateTransactionTrie, Transaction } from '@gxchain2/structure';
import { WrappedVM } from '@gxchain2/vm';
import { logger, getRandomIntInclusive, hexStringToBN } from '@gxchain2/utils';
import { StateManager } from '@gxchain2/vm';
import { RunTxResult } from '@ethereumjs/vm/dist/runTx';
import { PendingTxMap } from '../txpool';
import { Node } from '../node';

const emptyUncleHash = '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347';
const noTurnSignerDelay = 500;
const maxHistoryLength = 10;
const defaultGasLimit = hexStringToBN('0xbe5c8b');

function nowTimestamp() {
  return Math.floor(Date.now() / 1000);
}

export interface MinerOptions {
  node: Node;
  enable: boolean;
  coinbase?: string;
}

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

  private shouldMintNextBlock(currentHeader: BlockHeader) {
    return this.isMining && !this.node.blockchain.cliqueCheckNextRecentlySigned(currentHeader, this.coinbase);
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
   * Initialize the worker
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

  private async _newBlockHeader(header: BlockHeader, txMap?: PendingTxMap) {
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

      // Mint block logic.
      if (this.isMining) {
        if (this.nextTd && this.nextTd.lt(nextTd)) {
          this.nextTd = undefined;
          if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = undefined;
          }
        }
      }

      this.wvm = await this.node.getWrappedVM(header.stateRoot, newNumber);
      await this.wvm.vm.stateManager.checkpoint();
      await this._commit(txMap || (await this.node.txPool.getPendingTxMap(header.number, header.hash())));

      // Mint block logic.
      if (this.shouldMintNextBlock(header)) {
        this.nextTd = nextTd.clone();
        const now = nowTimestamp();
        let timeout = now > timestamp ? 0 : timestamp - now;
        timeout *= 1000;
        if (!inTurn) {
          const signerCount = this.node.blockchain.cliqueActiveSigners().length;
          timeout += getRandomIntInclusive(1, signerCount + 1) * noTurnSignerDelay;
        }
        const parentHash = header.hash();
        this.timeout = setTimeout(async () => {
          try {
            await this.lock.acquire();
            const pendingBlock = await this._getPendingBlockByParentHash(parentHash);
            if (!pendingBlock) {
              throw new Error(`Missing pending block, parentHash: ${bufferToHex(parentHash)}`);
            }
            const newBlock = await this.node.processBlock(pendingBlock, true, true);
            logger.info('⛏️  Mine block, height:', newBlock.header.number.toString(), 'hash:', bufferToHex(newBlock.hash()));
          } catch (err) {
            logger.error('Miner::_newBlock, setTimeout, catch error:', err);
          } finally {
            this.lock.release();
          }
        }, timeout);
      }
    } catch (err) {
      logger.error('Miner::_newBlock, catch error:', err);
    } finally {
      this.lock.release();
    }
  }

  /**
   * Add transactions for c
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
