import { Transaction } from '@ethereumjs/tx';
import { BN, bufferToHex, bnToHex, intToHex, rlp } from 'ethereumjs-util';
import { BaseTrie as Trie } from 'merkle-patricia-tree';

export function txSize(tx: Transaction) {
  const raw = tx.raw();
  let size = 0;
  for (const b of raw) {
    size += b.length;
  }
  return size;
}

export interface BlockLike {
  hash(): Buffer;
  readonly header: {
    number: BN;
  };
}

export class WrappedTransaction {
  public readonly transaction: Transaction;

  constructor(transaction: Transaction) {
    this.transaction = transaction;
  }

  extension: {
    blockHash?: Buffer;
    blockNumber?: BN;
    transactionIndex?: number;
    size?: number;
  } = {};

  get size() {
    if (this.extension.size) {
      return this.extension.size;
    }
    this.extension.size = txSize(this.transaction);
    return this.extension.size;
  }

  installProperties(block: BlockLike, transactionIndex: number): this {
    this.extension.blockHash = block.hash();
    this.extension.blockNumber = block.header.number;
    this.extension.transactionIndex = transactionIndex;
    return this;
  }

  toRPCJSON() {
    return {
      blockHash: this.extension.blockHash ? bufferToHex(this.extension.blockHash) : null,
      blockNumber: this.extension.blockNumber ? bnToHex(this.extension.blockNumber) : null,
      from: bufferToHex(this.transaction.getSenderAddress().toBuffer()),
      gas: bnToHex(this.transaction.gasLimit),
      gasPrice: bnToHex(this.transaction.gasPrice),
      hash: bufferToHex(this.transaction.hash()),
      input: bufferToHex(this.transaction.data),
      nonce: bnToHex(this.transaction.nonce),
      to: this.transaction.to !== undefined ? this.transaction.to.toString() : null,
      transactionIndex: this.extension.transactionIndex !== undefined ? intToHex(this.extension.transactionIndex) : null,
      value: bnToHex(this.transaction.value),
      v: this.transaction.v !== undefined ? bnToHex(this.transaction.v) : undefined,
      r: this.transaction.r !== undefined ? bnToHex(this.transaction.r) : undefined,
      s: this.transaction.s !== undefined ? bnToHex(this.transaction.s) : undefined
    };
  }
}

export async function calculateTransactionTrie(transactions: Transaction[]): Promise<Buffer> {
  const txTrie = new Trie();
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const key = rlp.encode(i);
    const value = tx.serialize();
    await txTrie.put(key, value);
  }
  return txTrie.root;
}

export function calculateIntrinsicGas(tx: Transaction) {
  const gas = tx.toCreationAddress() ? new BN(53000) : new BN(21000);
  const nz = new BN(0);
  const z = new BN(0);
  for (const b of tx.data) {
    (b !== 0 ? nz : z).iaddn(1);
  }
  gas.iadd(nz.muln(16));
  gas.iadd(z.muln(4));
  return gas;
}

export * from '@ethereumjs/tx';
