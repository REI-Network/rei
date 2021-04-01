import EventEmitter from 'events';
import { BN } from 'ethereumjs-util';
import { Transaction } from '@gxchain2/tx';
import { Block, BlockHeader, BlockBodyBuffer } from '@gxchain2/block';
import { createBufferFunctionalMap, logger } from '@gxchain2/utils';
import { Log } from '@gxchain2/receipt';
import { Node } from '../node';

export declare interface BlockchainMonitor {
  on(event: 'logs' | 'removedLogs', listener: (logs: Log[]) => void): this;
  on(event: 'newHeads', listener: (heads: BlockHeader[]) => void): this;

  once(event: 'logs' | 'removedLogs', listener: (logs: Log[]) => void): this;
  once(event: 'newHeads', listener: (heads: BlockHeader[]) => void): this;
}

export class BlockchainMonitor extends EventEmitter {
  private readonly node: Node;
  private readonly initPromise: Promise<void>;
  private currentHeader!: BlockHeader;

  constructor(node: Node) {
    super();
    this.node = node;
    this.initPromise = this.init();
  }

  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    await this.node.blockchain.init();
    this.currentHeader = this.node.blockchain.latestBlock.header;
  }

  async newBlock(block: Block) {
    await this.initPromise;
    try {
      const getBlock = async (hash: Buffer, number: BN) => {
        const header = await this.node.db.getHeader(hash, number);
        let bodyBuffer: BlockBodyBuffer | undefined;
        try {
          bodyBuffer = await this.node.db.getBody(hash, number);
        } catch (err) {
          if (err.type !== 'NotFoundError') {
            throw err;
          }
        }

        return Block.fromBlockData(
          {
            header: header,
            transactions: bodyBuffer ? bodyBuffer[0].map((rawTx) => Transaction.fromValuesArray(rawTx, { common: this.node.common })) : []
          },
          { common: this.node.common }
        );
      };

      const originalNewBlock = block;
      const newHeads: BlockHeader[] = [];
      let oldBlock = await getBlock(this.currentHeader.hash(), this.currentHeader.number);
      const discarded = createBufferFunctionalMap<Transaction>();
      const included = createBufferFunctionalMap<Transaction>();
      while (oldBlock.header.number.gt(block.header.number)) {
        for (const tx of oldBlock.transactions) {
          discarded.set(tx.hash(), tx);
        }
        oldBlock = await getBlock(oldBlock.header.parentHash, oldBlock.header.number.subn(1));
      }
      while (block.header.number.gt(oldBlock.header.number)) {
        newHeads.push(block.header);
        for (const tx of block.transactions) {
          included.set(tx.hash(), tx);
        }
        block = await getBlock(block.header.parentHash, block.header.number.subn(1));
      }
      while (!oldBlock.hash().equals(block.hash()) && oldBlock.header.number.gtn(0) && block.header.number.gtn(0)) {
        for (const tx of oldBlock.transactions) {
          discarded.set(tx.hash(), tx);
        }
        oldBlock = await getBlock(oldBlock.header.parentHash, oldBlock.header.number.subn(1));
        newHeads.push(block.header);
        for (const tx of block.transactions) {
          included.set(tx.hash(), tx);
        }
        block = await getBlock(block.header.parentHash, block.header.number.subn(1));
      }
      if (!oldBlock.hash().equals(block.hash())) {
        throw new Error('reorg failed');
      }
      const removed: Transaction[] = [];
      for (const tx of discarded.values()) {
        if (!included.has(tx.hash())) {
          removed.push(tx);
        }
      }
      const rebirthed: Transaction[] = [];
      for (const tx of included.values()) {
        if (!discarded.has(tx.hash())) {
          rebirthed.push(tx);
        }
      }
      // reset current header.
      this.currentHeader = originalNewBlock.header;
      // emit event.
      if (removed.length > 0) {
        let removedLogs: Log[] = [];
        for (const tx of removed) {
          const receipt = await this.node.db.getReceipt(tx.hash());
          receipt.logs.forEach((log) => (log.removed = true));
          removedLogs = removedLogs.concat(receipt.logs);
        }
        this.emit('removedLogs', removedLogs);
      }
      if (rebirthed.length > 0) {
        let logs: Log[] = [];
        for (const tx of removed) {
          const receipt = await this.node.db.getReceipt(tx.hash());
          receipt.logs.forEach((log) => (log.removed = false));
          logs = logs.concat(receipt.logs);
        }
        this.emit('logs', logs);
      }
      if (newHeads.length > 0) {
        this.emit('newHeads', newHeads);
      }
    } catch (err) {
      logger.error('BlockchainMonitor::newBlock, catch error:', err);
    }
  }
}
