import { TxReceipt } from '@gxchain2-ethereumjs/vm/dist/types';
import { encodeReceipt } from '@gxchain2-ethereumjs/vm/dist/runBlock';
import { BaseTrie } from 'merkle-patricia-tree';
import { toBuffer } from 'ethereumjs-util';
import { Common } from '@gxchain2/common';
import { TypedTransaction } from '@gxchain2/structure';

export function isEnableStaking(common: Common) {
  if (common.chainName() === 'gxc2-testnet') {
    return common.gteHardfork('testnet-hf1');
  } else if (common.chainName() === 'gxc2-mainnet') {
    return common.gteHardfork('mainnet-hf1');
  } else {
    throw new Error('unknown chain');
  }
}

export function isEnableReceiptRootFix(common: Common) {
  if (common.chainName() === 'gxc2-testnet') {
    return common.gteHardfork('testnet-hf1');
  } else if (common.chainName() === 'gxc2-mainnet') {
    return common.gteHardfork('mainnet-chainstart');
  } else {
    throw new Error('unknown chain');
  }
}

export async function preHF1GenReceiptTrie(transactions: TypedTransaction[], receipts: TxReceipt[]) {
  const trie = new BaseTrie();
  for (let i = 0; i < receipts.length; i++) {
    await trie.put(toBuffer(i), encodeReceipt(transactions[i], receipts[i]));
  }
  return trie.root;
}
