import { BN } from 'ethereumjs-util';
import { Transaction, Block, BlockHeader, Log } from '@rei-network/structure';
import { FunctionalBufferMap, logger, InitializerWithEventEmitter } from '@rei-network/utils';
import { Database } from '@rei-network/database';

// record block hash and block number for quering receipt.
type TransactionInfo = { tx: Transaction; blockHash: Buffer; blockNumber: BN };

/**
 * Events for new transactions and blocks in the blockchain
 */
export declare interface BlockchainMonitor {
  on(event: 'logs' | 'removedLogs', listener: (logs: Log[]) => void): this;
  on(event: 'newHeads', listener: (hashes: Buffer[]) => void): this;

  off(event: 'logs' | 'removedLogs', listener: (logs: Log[]) => void): this;
  off(event: 'newHeads', listener: (hashes: Buffer[]) => void): this;
}

/**
 * BlockchainMonitor is used to monitor changes on the chain
 */
export class BlockchainMonitor extends InitializerWithEventEmitter {
  private db: Database;
  private currentHeader!: BlockHeader;

  constructor(db: Database) {
    super();
    this.db = db;
  }

  /**
   * initialization
   */
  init(header: BlockHeader) {
    this.currentHeader = header;
    this.initOver();
  }

  /**
   * After getting a new block, this method will compare it with the latest block in the local database, find their
   * common ancestor and record the new transactions, blockheads, or transactions which need to rolled back, then
   * emit the corresponding events
   *
   * @param block New Block data
   */
  async newBlock(block: Block) {
    await this.initPromise;
    try {
      const originalNewBlock = block;
      const newHeads: BlockHeader[] = [];
      let oldBlock = await this.db.getBlockByHashAndNumber(this.currentHeader.hash(), this.currentHeader.number);
      const discarded = new FunctionalBufferMap<TransactionInfo>();
      const included = new FunctionalBufferMap<TransactionInfo>();
      while (oldBlock.header.number.gt(block.header.number)) {
        const blockHash = oldBlock.hash();
        for (const tx of oldBlock.transactions as Transaction[]) {
          discarded.set(tx.hash(), { tx, blockHash, blockNumber: oldBlock.header.number });
        }
        oldBlock = await this.db.getBlockByHashAndNumber(oldBlock.header.parentHash, oldBlock.header.number.subn(1));
      }
      while (block.header.number.gt(oldBlock.header.number)) {
        newHeads.push(block.header);
        const blockHash = block.hash();
        for (const tx of block.transactions as Transaction[]) {
          included.set(tx.hash(), { tx, blockHash, blockNumber: block.header.number });
        }
        block = await this.db.getBlockByHashAndNumber(block.header.parentHash, block.header.number.subn(1));
      }
      while (!oldBlock.hash().equals(block.hash()) && oldBlock.header.number.gtn(0) && block.header.number.gtn(0)) {
        {
          const blockHash = oldBlock.hash();
          for (const tx of oldBlock.transactions as Transaction[]) {
            discarded.set(tx.hash(), { tx, blockHash, blockNumber: oldBlock.header.number });
          }
        }
        oldBlock = await this.db.getBlockByHashAndNumber(oldBlock.header.parentHash, oldBlock.header.number.subn(1));

        {
          newHeads.push(block.header);
          const blockHash = block.hash();
          for (const tx of block.transactions as Transaction[]) {
            included.set(tx.hash(), { tx, blockHash, blockNumber: block.header.number });
          }
        }
        block = await this.db.getBlockByHashAndNumber(block.header.parentHash, block.header.number.subn(1));
      }
      if (!oldBlock.hash().equals(block.hash())) {
        throw new Error('reorg failed');
      }
      const removed: TransactionInfo[] = [];
      for (const txInfo of discarded.values()) {
        if (!included.has(txInfo.tx.hash())) {
          removed.push(txInfo);
        }
      }
      const rebirthed: TransactionInfo[] = [];
      for (const txInfo of included.values()) {
        if (!discarded.has(txInfo.tx.hash())) {
          rebirthed.push(txInfo);
        }
      }
      // reset current header.
      this.currentHeader = originalNewBlock.header;
      // emit event.
      if (removed.length > 0) {
        let removedLogs: Log[] = [];
        for (const txInfo of removed) {
          try {
            const receipt = await this.db.getReceiptByHashAndNumber(txInfo.tx.hash(), txInfo.blockHash, txInfo.blockNumber);
            receipt.logs.forEach((log) => (log.removed = true));
            removedLogs = removedLogs.concat(receipt.logs);
          } catch (err: any) {
            if (err.type === 'NotFoundError') {
              continue;
            }
            throw err;
          }
        }
        if (removedLogs.length > 0) {
          this.emit('removedLogs', removedLogs);
        }
      }
      if (rebirthed.length > 0) {
        let logs: Log[] = [];
        for (const txInfo of rebirthed) {
          try {
            const receipt = await this.db.getReceipt(txInfo.tx.hash());
            receipt.logs.forEach((log) => (log.removed = false));
            logs = logs.concat(receipt.logs);
          } catch (err: any) {
            if (err.type === 'NotFoundError') {
              continue;
            }
            throw err;
          }
        }
        if (logs.length > 0) {
          this.emit('logs', logs);
        }
      }
      if (newHeads.length > 0) {
        newHeads.sort((a, b) => {
          if (a.number.lt(b.number)) {
            return -1;
          }
          if (a.number.gt(b.number)) {
            return 1;
          }
          return 0;
        });
        this.emit(
          'newHeads',
          newHeads.map((head) => head.hash())
        );
      }
    } catch (err) {
      logger.error('BlockchainMonitor::newBlock, catch error:', err);
    }
  }
}
