import EventEmitter from 'events';
import { BN } from 'ethereumjs-util';
import { TxFromValuesArray, TypedTransaction, Block, BlockHeader, BlockBodyBuffer, Log } from '@gxchain2/structure';
import { createBufferFunctionalMap, logger } from '@gxchain2/utils';
import { Node } from '../node';

// record block hash and block number for quering receipt.
type TransactionInfo = { tx: TypedTransaction; blockHash: Buffer; blockNumber: BN };

export declare interface BlockchainMonitor {
  on(event: 'logs' | 'removedLogs', listener: (logs: Log[]) => void): this;
  on(event: 'newHeads', listener: (hashes: Buffer[]) => void): this;

  once(event: 'logs' | 'removedLogs', listener: (logs: Log[]) => void): this;
  once(event: 'newHeads', listener: (hashes: Buffer[]) => void): this;
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
            transactions: bodyBuffer ? bodyBuffer[0].map((rawTx) => TxFromValuesArray(rawTx, { common: this.node.getCommon(number) })) : []
          },
          { common: this.node.getCommon(number) }
        );
      };

      const originalNewBlock = block;
      const newHeads: BlockHeader[] = [];
      let oldBlock = await getBlock(this.currentHeader.hash(), this.currentHeader.number);
      const discarded = createBufferFunctionalMap<TransactionInfo>();
      const included = createBufferFunctionalMap<TransactionInfo>();
      while (oldBlock.header.number.gt(block.header.number)) {
        const blockHash = oldBlock.hash();
        for (const tx of oldBlock.transactions) {
          discarded.set(tx.hash(), { tx, blockHash, blockNumber: oldBlock.header.number });
        }
        oldBlock = await getBlock(oldBlock.header.parentHash, oldBlock.header.number.subn(1));
      }
      while (block.header.number.gt(oldBlock.header.number)) {
        newHeads.push(block.header);
        const blockHash = block.hash();
        for (const tx of block.transactions) {
          included.set(tx.hash(), { tx, blockHash, blockNumber: block.header.number });
        }
        block = await getBlock(block.header.parentHash, block.header.number.subn(1));
      }
      while (!oldBlock.hash().equals(block.hash()) && oldBlock.header.number.gtn(0) && block.header.number.gtn(0)) {
        {
          const blockHash = oldBlock.hash();
          for (const tx of oldBlock.transactions) {
            discarded.set(tx.hash(), { tx, blockHash, blockNumber: oldBlock.header.number });
          }
        }
        oldBlock = await getBlock(oldBlock.header.parentHash, oldBlock.header.number.subn(1));

        {
          newHeads.push(block.header);
          const blockHash = block.hash();
          for (const tx of block.transactions) {
            included.set(tx.hash(), { tx, blockHash, blockNumber: block.header.number });
          }
        }
        block = await getBlock(block.header.parentHash, block.header.number.subn(1));
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
            const receipt = await this.node.db.getReceiptByHashAndNumber(txInfo.tx.hash(), txInfo.blockHash, txInfo.blockNumber);
            receipt.logs.forEach((log) => (log.removed = true));
            removedLogs = removedLogs.concat(receipt.logs);
          } catch (err) {
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
            const receipt = await this.node.db.getReceipt(txInfo.tx.hash());
            receipt.logs.forEach((log) => (log.removed = false));
            logs = logs.concat(receipt.logs);
          } catch (err) {
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
