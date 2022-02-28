import { BN } from 'ethereumjs-util';
import { Database } from '@rei-network/database';
import { Receipt } from '@rei-network/structure';
import { FunctionalBufferMap } from '@rei-network/utils';

const defaultMaxSize = 1;

export class ReceiptsCache {
  private hashes: Buffer[] = [];
  private receipts = new FunctionalBufferMap<Receipt[]>();
  private maxSize: number;

  constructor(maxSize?: number) {
    this.maxSize = maxSize ?? defaultMaxSize;
    if (this.maxSize < 1) {
      throw new Error('invalid max size');
    }
  }

  add(hash: Buffer, receipts: Receipt[]) {
    this.hashes.push(hash);
    if (this.hashes.length > this.maxSize) {
      this.receipts.delete(this.hashes.shift()!);
    }
    this.receipts.set(hash, receipts);
  }

  async get(num: Buffer | BN | number, db: Database) {
    if (typeof num === 'number') {
      num = await db.numberToHash(new BN(num));
    } else if (num instanceof BN) {
      num = await db.numberToHash(num);
    }
    const hash = num;

    let receipts = this.receipts.get(hash);
    if (receipts === undefined) {
      const block = await db.getBlock(hash);
      receipts = await db.getReceipts(block.header.number, block.hash(), block);
      this.add(hash, receipts);
    }
    return receipts;
  }
}
