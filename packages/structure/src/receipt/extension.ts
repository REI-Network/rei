import { BN, generateAddress } from 'ethereumjs-util';
import { Block } from '../block';
import { Transaction } from '../tx';

export class ReceiptExtension {
  gasUsed: BN;
  blockHash: Buffer;
  blockNumber: BN;
  contractAddress?: Buffer;
  from: Buffer;
  to?: Buffer;
  transactionHash: Buffer;
  transactionIndex: number;

  constructor(block: Block, tx: Transaction, gasUsed: BN, txIndex: number) {
    this.blockHash = block.hash();
    this.blockNumber = block.header.number;
    this.from = tx.getSenderAddress().toBuffer();
    this.contractAddress = tx.to
      ? undefined
      : generateAddress(this.from!, tx.nonce.toArrayLike(Buffer));
    this.gasUsed = gasUsed;
    this.to = tx?.to?.toBuffer();
    this.transactionHash = tx.hash();
    this.transactionIndex = txIndex;
  }
}

export class LogExtension {
  blockHash: Buffer;
  blockNumber: BN;
  logIndex: number;
  transactionHash: Buffer;
  transactionIndex: number;

  constructor(receipt: ReceiptExtension, logIndex: number) {
    this.blockHash = receipt.blockHash;
    this.blockNumber = receipt.blockNumber;
    this.transactionHash = receipt.transactionHash;
    this.transactionIndex = receipt.transactionIndex;
    this.logIndex = logIndex;
  }
}
