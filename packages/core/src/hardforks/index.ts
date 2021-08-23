import { TxReceipt } from '@gxchain2-ethereumjs/vm/dist/types';
import { encodeReceipt } from '@gxchain2-ethereumjs/vm/dist/runBlock';
import { BaseTrie } from 'merkle-patricia-tree';
import { toBuffer } from 'ethereumjs-util';
import { Common } from '@gxchain2/common';
import { TypedTransaction } from '@gxchain2/structure';

/**
 * Check whether staking logic is enabled
 * @param common - Common instance
 * @returns Enable if `true`
 */
export function isEnableStaking(common: Common) {
  if (common.chainName() === 'gxc2-testnet') {
    return common.gteHardfork('testnet-hf1');
  } else if (common.chainName() === 'gxc2-mainnet') {
    return common.gteHardfork('mainnet-hf1');
  } else {
    throw new Error('unknown chain');
  }
}

/**
 * Check whether the fix of generating receipt root is enabled
 * @param common - Common instance
 * @returns Enable if `true`
 */
export function isEnableReceiptRootFix(common: Common) {
  if (common.chainName() === 'gxc2-testnet') {
    return common.gteHardfork('testnet-hf1');
  } else if (common.chainName() === 'gxc2-mainnet') {
    return common.gteHardfork('mainnet-chainstart');
  } else {
    throw new Error('unknown chain');
  }
}

/**
 * Generate receipt root before `hf1`
 * @param transactions - List of transaction
 * @param receipts - List of receipt
 * @returns Receipt root
 */
export async function preHF1GenReceiptTrie(transactions: TypedTransaction[], receipts: TxReceipt[]) {
  const trie = new BaseTrie();
  for (let i = 0; i < receipts.length; i++) {
    await trie.put(toBuffer(i), encodeReceipt(transactions[i], receipts[i]));
  }
  return trie.root;
}
