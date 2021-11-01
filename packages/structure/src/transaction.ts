import { TxOptions, Transaction } from '@gxchain2-ethereumjs/tx';
import { BN, bufferToHex, bnToHex, intToHex, rlp } from 'ethereumjs-util';
import { BaseTrie as Trie } from 'merkle-patricia-tree';
import { Block } from './block';

export * from '@gxchain2-ethereumjs/tx';

/**
 * Calculate transaction trie
 * @param transactions - Transactions
 * @returns Transaction trie
 */
export async function calcTransactionTrie(transactions: Transaction[]): Promise<Buffer> {
  const trie = new Trie();
  for (const [i, tx] of transactions.entries()) {
    await trie.put(rlp.encode(i), tx.serialize());
  }
  return trie.root;
}

/**
 * Calculate intrinsic gas
 * @param tx - Transaction
 * @returns Intrinsic gas
 */
export function calcIntrinsicGasByTx(tx: Transaction) {
  return calcIntrinsicGas(tx.toCreationAddress(), tx.data);
}

/**
 * Calculate intrinsic gas
 * @param isCreate - Is a contract creation transaction
 * @param data - Transaction data
 * @returns Intrinsic gas
 */
export function calcIntrinsicGas(isCreate: boolean, data: Buffer) {
  const gas = isCreate ? new BN(53000) : new BN(21000);
  const nz = new BN(0);
  const z = new BN(0);
  for (const b of data) {
    (b !== 0 ? nz : z).iaddn(1);
  }
  gas.iadd(nz.muln(16));
  gas.iadd(z.muln(4));
  return gas;
}

/**
 * Calculate the size of the transaction
 * @param tx - Transaction
 * @returns Transaction size
 */
export function calcTxSize(tx: Transaction) {
  const raw = tx.raw();
  let size = 0;
  for (const b of raw) {
    if (b instanceof Buffer) {
      size += b.length;
    }
  }
  return size;
}

/**
 * Generate transaction object by given values
 * If transaction isn't `LegacyTransaction`, it will throw an error
 * @param values - Transaction values
 * @param opts - The options for initializing a Transaction.
 * @returns Transaction object
 */
export function mustParseTransction(values: Buffer[], opts?: TxOptions) {
  if (values.length === 6 || values.length === 9) {
    return Transaction.fromValuesArray(values, opts);
  }
  throw new Error('invalid tx data');
}

/**
 * WrappedTransaction based on `@gxchain2-ethereumjs/tx`
 */
export class WrappedTransaction {
  public readonly transaction: Transaction;

  constructor(transaction: Transaction) {
    this.transaction = transaction;
  }

  blockHash?: Buffer;
  blockNumber?: BN;
  transactionIndex?: number;
  _size?: number;

  /**
   * Get size of the transaction
   */
  get size() {
    if (this._size) {
      return this._size;
    }
    this._size = calcTxSize(this.transaction);
    return this._size;
  }

  /**
   * Add additional information for transaction
   * @param block - Block
   * @param transactionIndex - Transaction index
   * @returns Transaction object
   */
  installProperties(block: Block, transactionIndex: number): this {
    this.blockHash = block.hash();
    this.blockNumber = block.header.number;
    this.transactionIndex = transactionIndex;
    return this;
  }

  /**
   * Convert transaction to json format
   * @returns JSON format transaction
   */
  toRPCJSON() {
    return {
      blockHash: this.blockHash ? bufferToHex(this.blockHash) : null,
      blockNumber: this.blockNumber ? bnToHex(this.blockNumber) : null,
      from: bufferToHex(this.transaction.getSenderAddress().toBuffer()),
      gas: bnToHex(this.transaction.gasLimit),
      gasPrice: bnToHex(this.transaction.gasPrice),
      hash: bufferToHex(this.transaction.hash()),
      input: bufferToHex(this.transaction.data),
      nonce: bnToHex(this.transaction.nonce),
      to: this.transaction.to !== undefined ? this.transaction.to.toString() : null,
      transactionIndex: this.transactionIndex !== undefined ? intToHex(this.transactionIndex) : null,
      value: bnToHex(this.transaction.value),
      v: this.transaction.v !== undefined ? bnToHex(this.transaction.v) : undefined,
      r: this.transaction.r !== undefined ? bnToHex(this.transaction.r) : undefined,
      s: this.transaction.s !== undefined ? bnToHex(this.transaction.s) : undefined
    };
  }
}
