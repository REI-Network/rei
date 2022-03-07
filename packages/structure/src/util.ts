import { BN, rlp } from 'ethereumjs-util';
import { BaseTrie as Trie } from 'merkle-patricia-tree';
import { TxOptions, Transaction } from './tx';

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
