import { BN } from 'ethereumjs-util';
import { Block, BlockHeader } from '@gxchain2/block';
import { calculateTransactionTrie, Transaction } from '@gxchain2/tx';
import { PendingTxMap } from '@gxchain2/tx-pool';
import { WrappedVM } from '@gxchain2/vm';
import { logger } from '@gxchain2/utils';
import { RunTxResult } from '@ethereumjs/vm/dist/runTx';
import { Loop } from './loop';
import { Miner } from './miner';
import { Node } from '../node';

export class Worker extends Loop {
  private readonly miner: Miner;
  private readonly node: Node;
  private readonly initPromise: Promise<void>;

  private wvm!: WrappedVM;
  private txs: Transaction[] = [];
  private header!: BlockHeader;
  private gasUsed = new BN(0);

  constructor(node: Node, miner: Miner) {
    super(3000);
    this.node = node;
    this.miner = miner;
    this.initPromise = this.init();
  }

  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    await this._newBlock(this.node.blockchain.latestBlock);
  }

  async newBlock(block: Block) {
    await this.initPromise;
    await this._newBlock(block);
  }

  private async _newBlock(block: Block) {
    try {
      if (this.wvm) {
        await this.wvm.vm.stateManager.revert();
      }
      this.txs = [];
      this.gasUsed = new BN(0);
      this.header = BlockHeader.fromHeaderData(
        {
          coinbase: this.miner.coinbase,
          difficulty: '0x1',
          gasLimit: this.miner.gasLimit,
          nonce: '0x0102030405060708',
          number: block.header.number.addn(1),
          parentHash: block.header.hash(),
          uncleHash: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347'
        },
        { common: this.node.common }
      );
      await (this.wvm = await this.node.getWrappedVM(block.header.stateRoot)).vm.stateManager.checkpoint();
      await this.commit(this.node.txPool.getPendingMap());
    } catch (err) {
      logger.error('Worker::_newBlock, catch error:', err);
    }
  }

  async addTxs(txs: Map<Buffer, Transaction[]>) {
    await this.initPromise;
    try {
      const pendingMap = new PendingTxMap();
      for (const [sender, sortedTxs] of txs) {
        pendingMap.push(sender, sortedTxs);
      }
      await this.commit(pendingMap);
    } catch (err) {
      logger.error('Worker::addTxs, catch error:', err);
    }
  }

  async getPendingBlock() {
    await this.initPromise;
    const txs = [...this.txs];
    const header = { ...this.header };
    return Block.fromBlockData(
      {
        header: {
          ...header,
          timestamp: new BN(Date.now()),
          transactionsTrie: await calculateTransactionTrie(txs)
        },
        transactions: txs
      },
      { common: this.node.common }
    );
  }

  async startLoop() {
    await this.initPromise;
    await super.startLoop();
  }

  protected async process() {
    await this.newBlock(this.node.blockchain.latestBlock);
  }

  private async commit(pendingMap: PendingTxMap) {
    let tx = pendingMap.peek();
    while (tx) {
      try {
        await this.wvm.vm.stateManager.checkpoint();

        let txRes: RunTxResult;
        try {
          txRes = await this.wvm.vm.runTx({
            tx,
            block: Block.fromBlockData({ header: this.header }, { common: this.node.common }),
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
