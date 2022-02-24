import { BN } from 'ethereumjs-util';
import { Block } from '../block';

export class TransactionExtension {
  readonly blockHash: Buffer;
  readonly blockNumber: BN;
  readonly transactionIndex: number;

  constructor(block: Block, transactionIndex: number) {
    this.blockHash = block.hash();
    this.blockNumber = block.header.number;
    this.transactionIndex = transactionIndex;
  }
}
