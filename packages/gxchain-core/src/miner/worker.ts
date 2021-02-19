import { BN } from 'ethereumjs-util';
import { Block, BlockHeader } from '@gxchain2/block';
import { Transaction, calculateTransactionTrie, WrappedTransaction } from '@gxchain2/tx';
import { PendingTxMap } from '@gxchain2/tx-pool';
import { WrappedVM } from '@gxchain2/vm';
import { RunTxResult } from '@ethereumjs/vm/dist/runTx';
import { Node } from '../node';

export class Worker {
  private readonly node: Node;
  private readonly initPromise: Promise<void>;
  private wvm!: WrappedVM;
  private txs: WrappedTransaction[] = [];
  private header!: BlockHeader;
  private gasUsed = new BN(0);

  constructor(node: Node) {
    this.node = node;
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
    if (this.wvm) {
      await this.wvm.vm.stateManager.revert();
    }
    this.txs = [];
    this.gasUsed = new BN(0);
    this.header = BlockHeader.fromHeaderData(
      {
        coinbase: this.node.coinbase,
        difficulty: '0x1',
        gasLimit: block.header.gasLimit,
        nonce: '0x0102030405060708',
        number: block.header.number.addn(1),
        parentHash: block.header.hash(),
        uncleHash: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347'
      },
      { common: this.node.common }
    );
    await (this.wvm = await this.node.getWrappedVM(block.header.stateRoot)).vm.stateManager.checkpoint();
    await this.commit(await this.node.txPool.getPendingMap());
  }

  async addTxs(map: Map<Buffer, WrappedTransaction[]>) {
    await this.initPromise;
    const pendingMap = new PendingTxMap();
    for (const [sender, sortedTxs] of map) {
      pendingMap.push(sender, sortedTxs);
    }
    await this.commit(pendingMap);
  }

  async getPendingBlock() {
    await this.initPromise;
    return Block.fromBlockData(
      {
        header: {
          ...this.header,
          timestamp: new BN(Date.now()),
          transactionsTrie: await calculateTransactionTrie(this.txs.map((tx) => tx.transaction))
        },
        transactions: this.txs.map((tx) => tx.transaction)
      },
      { common: this.node.common }
    );
  }

  private async commit(pendingMap: PendingTxMap) {
    let tx = pendingMap.peek();
    while (tx) {
      try {
        await this.wvm.vm.stateManager.checkpoint();

        let txRes: RunTxResult;
        try {
          txRes = await this.wvm.vm.runTx({
            tx: tx.transaction,
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
