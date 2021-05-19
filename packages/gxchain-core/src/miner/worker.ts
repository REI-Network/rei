import { Address, BN } from 'ethereumjs-util';
import Semaphore from 'semaphore-async-await';
import { Block, BlockHeader, calcCliqueDifficulty, CLIQUE_DIFF_NOTURN } from '@gxchain2/block';
import { calculateTransactionTrie, TypedTransaction } from '@gxchain2/tx';
import { PendingTxMap } from '@gxchain2/tx-pool';
import { WrappedVM } from '@gxchain2/vm';
import { logger } from '@gxchain2/utils';
import { StateManager } from '@gxchain2/state-manager';
import { RunTxResult } from '@ethereumjs/vm/dist/runTx';
import { Loop } from './loop';
import { Miner } from './miner';
import { Node } from '../node';
import { getPrivateKey } from '../fakeaccountmanager';

export class Worker extends Loop {
  private readonly miner: Miner;
  private readonly node: Node;
  private readonly initPromise: Promise<void>;

  private wvm!: WrappedVM;
  private txs: TypedTransaction[] = [];
  private header!: BlockHeader;
  private currentHeader!: BlockHeader;
  private gasUsed = new BN(0);
  private history: [number, Buffer, BlockHeader, Block][] = [];
  private lock = new Semaphore(1);

  constructor(node: Node, miner: Miner) {
    super(1000);
    this.node = node;
    this.miner = miner;
    this.initPromise = this.init();
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

  private async makeHeader(timestamp: number, parentHash: Buffer, number: BN) {
    if (this.miner.isMining) {
      const signer = new Address(this.miner.coinbase);
      const [inTurn, difficulty] = calcCliqueDifficulty(this.node.blockchain.cliqueActiveSigners(), signer, number);
      return BlockHeader.fromHeaderData(
        {
          // TODO: add beneficiary.
          coinbase: Address.zero(),
          difficulty,
          gasLimit: this.miner.gasLimit,
          // TODO: add beneficiary.
          nonce: Buffer.alloc(8),
          number,
          parentHash,
          timestamp,
          uncleHash: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347'
        },
        { common: this.node.getCommon(number), cliqueSigner: getPrivateKey(this.miner.coinbase.toString('hex')) }
      );
    } else {
      return BlockHeader.fromHeaderData(
        {
          coinbase: Address.zero(),
          difficulty: CLIQUE_DIFF_NOTURN.clone(),
          gasLimit: this.miner.gasLimit,
          nonce: Buffer.alloc(8),
          number,
          parentHash,
          timestamp,
          uncleHash: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
          transactionsTrie: await calculateTransactionTrie([])
        },
        { common: this.node.getCommon(number) }
      );
    }
  }

  private async _newBlockHeader(header: BlockHeader, txMap?: PendingTxMap) {
    try {
      await this.lock.acquire();
      if (this.wvm) {
        await this.wvm.vm.stateManager.revert();
      }
      // save history pending blocks.
      if (this.header !== undefined && this.header.number.gtn(0)) {
        const number = this.header.number.toNumber() - 1;
        const hash = this.header.parentHash;
        if (!this.history.find((h) => h[0] === number && h[1].equals(hash))) {
          this.history.push([this.header.number.toNumber() - 1, this.header.parentHash, this.currentHeader, await this.getPendingBlock()]);
          if (this.history.length > 10) {
            this.history.shift();
          }
        }
      }
      this.txs = [];
      this.gasUsed = new BN(0);
      this.currentHeader = header;
      const newNumber = header.number.addn(1);
      this.header = await this.makeHeader(Math.floor(Date.now() / 1000), header.hash(), header.number.addn(1));
      this.wvm = await this.node.getWrappedVM(header.stateRoot, newNumber);
      await this.wvm.vm.stateManager.checkpoint();
      await this.commit(txMap || (await this.node.txPool.getPendingTxMap(header.number, header.hash())));
    } catch (err) {
      logger.error('Worker::_newBlock, catch error:', err);
    } finally {
      this.lock.release();
    }
  }

  /**
   * Add transactions for c
   * @param txs - The map of Buffer and array of transactions
   */
  async addTxs(txs: Map<Buffer, TypedTransaction[]>) {
    await this.initPromise;
    try {
      await this.lock.acquire();
      const pendingMap = new PendingTxMap();
      for (const [sender, sortedTxs] of txs) {
        pendingMap.push(sender, sortedTxs);
      }
      await this.commit(pendingMap);
    } catch (err) {
      logger.error('Worker::addTxs, catch error:', err);
    } finally {
      this.lock.release();
    }
  }

  private getCliqueSigner() {
    return this.miner.isMining ? getPrivateKey(this.miner.coinbase.toString('hex')) : undefined;
  }

  async getRecord_OrderByTD(number: BN): Promise<undefined | [BlockHeader, Block]> {
    const records: [BlockHeader, Block][] = this.history.filter((v) => v[0] === number.toNumber()).map((r) => [r[2], r[3]]);
    if (number.addn(1).eq(this.header.number)) {
      const number = this.header.number.toNumber() - 1;
      const hash = this.header.parentHash;
      if (!this.history.find((h) => h[0] === number && h[1].equals(hash))) {
        records.push([this.currentHeader, await this.getPendingBlock()]);
      }
    }
    if (records.length === 1) {
      return [records[0][0], records[0][1]];
    }
    if (records.length > 0) {
      const record = (
        await Promise.all(
          records.map(async (record) => {
            return {
              record,
              td: await this.node.db.getTotalDifficulty(record[0].hash(), record[0].number)
            };
          })
        )
      ).sort((a, b) => {
        if (a.td.lt(b.td)) {
          return 1;
        }
        if (a.td.gt(b.td)) {
          return -1;
        }
        return 0;
      })[0].record;
      return record;
    }
  }

  /**
   * Assembles the pending block from block data
   * @returns
   */
  async getPendingBlock(timestamp?: number) {
    await this.initPromise;
    const txs = [...this.txs];
    const header = { ...this.header };
    return Block.fromBlockData(
      {
        header: {
          ...header,
          timestamp: timestamp || Math.floor(Date.now() / 1000),
          transactionsTrie: await calculateTransactionTrie(txs)
        },
        transactions: txs
      },
      { common: this.node.getCommon(header.number), hardforkByBlockNumber: true, cliqueSigner: this.getCliqueSigner() }
    );
  }

  async getPendingStateManager() {
    await this.initPromise;
    if (this.wvm) {
      return new StateManager({ common: (this.wvm.vm.stateManager as any)._common, trie: (this.wvm.vm.stateManager as any)._trie.copy(false) });
    }
    return await this.node.getStateManager(this.node.blockchain.latestBlock.header.stateRoot, this.node.blockchain.latestHeight);
  }

  protected async process() {
    if (this.lock.getPermits() > 0) {
      const [number, hash] = this.node.txPool.getCurrentHeader();
      if (number.eq(this.currentHeader.number) && hash.equals(this.currentHeader.hash())) {
        const txMap = await this.node.txPool.getPendingTxMap(this.currentHeader.number, this.currentHeader.hash());
        if (this.lock.getPermits() > 0 && number.eq(this.currentHeader.number) && hash.equals(this.currentHeader.hash())) {
          await this._newBlockHeader(this.currentHeader, txMap);
        }
      }
    }
  }

  private async commit(pendingMap: PendingTxMap) {
    let tx = pendingMap.peek();
    while (tx) {
      try {
        await this.wvm.vm.stateManager.checkpoint();

        let txRes: RunTxResult;
        tx.common.setHardforkByBlockNumber(this.header.number);
        try {
          txRes = await this.wvm.vm.runTx({
            tx,
            block: Block.fromBlockData({ header: this.header }, { common: (this.wvm.vm.stateManager as any)._common }),
            skipBalance: false,
            skipNonce: false
          });
        } catch (err) {
          await this.wvm.vm.stateManager.revert();
          pendingMap.pop();
          tx = pendingMap.peek();
          continue;
        }

        if (this.header.gasLimit.lt(txRes.gasUsed.add(this.gasUsed))) {
          await this.wvm.vm.stateManager.revert();
          pendingMap.pop();
        } else {
          await this.wvm.vm.stateManager.commit();
          this.txs.push(tx);
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
