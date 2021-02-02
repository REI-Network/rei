import { Block, BlockHeader } from '@gxchain2/block';
import { Transaction } from '@gxchain2/tx';
import { PendingTxMap } from '@gxchain2/tx-pool';
import VM from '@gxchain2/vm';
import { BN } from 'ethereumjs-util';
import { Node } from '../node';

export class Worker {
  private readonly node: Node;
  private header!: BlockHeader;
  private vm!: VM;
  private gasLimit = new BN(0);
  private txs: Transaction[] = [];
  private initPromise: Promise<void>;

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
    if (this.vm) {
      await this.vm.stateManager.revert();
    }
    this.txs = [];
    this.gasLimit = new BN(0);
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
    await (this.vm = await this.node.getVM(block.header.stateRoot)).stateManager.checkpoint();
    await this.commit(await this.node.txPool.getPendingMap());
  }

  async addTxs(map: Map<Buffer, Transaction[]>) {
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
          transactionsTrie: await Transaction.calculateTransactionTrie(this.txs)
        },
        transactions: this.txs
      },
      { common: this.node.common }
    );
  }

  private async commit(pendingMap: PendingTxMap) {
    let tx = pendingMap.peek();
    while (tx) {
      try {
        if (this.header.gasLimit.lt(tx.gasLimit.add(this.gasLimit))) {
          pendingMap.pop();
        } else {
          await this.vm.runTx({
            tx,
            block: Block.fromBlockData({ header: this.header }, { common: this.node.common }),
            skipBalance: false,
            skipNonce: false
          });
          this.txs.push(tx);
          this.gasLimit.iadd(tx.gasLimit);
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
