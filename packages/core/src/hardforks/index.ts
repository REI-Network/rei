import { TxReceipt } from '@gxchain2-ethereumjs/vm/dist/types';
import { encodeReceipt } from '@gxchain2-ethereumjs/vm/dist/runBlock';
import { BaseTrie } from 'merkle-patricia-tree';
import { rlp, rlphash, toBuffer } from 'ethereumjs-util';
import { Common } from '@gxchain2/common';
import { TypedTransaction, BlockHeader, HashFunction, setCustomHashFunction, CLIQUE_EXTRA_VANITY } from '@gxchain2/structure';
import { ConsensusType } from '../consensus/types';
import { BlockHeader_hash } from '../consensus/reimint/types';

const customHashFunction: HashFunction = (header: BlockHeader) => {
  if (header.extraData.length <= CLIQUE_EXTRA_VANITY || getConsensusTypeByCommon(header._common) === ConsensusType.Clique) {
    return rlphash(header.raw());
  } else {
    return BlockHeader_hash(header);
  }
};

setCustomHashFunction(customHashFunction);

/**
 * Get consensus engine type by common instance
 * @param common - Common instance
 * @returns Consensus type
 */
export function getConsensusTypeByCommon(common: Common) {
  if (common.chainName() === 'gxc2-testnet') {
    return common.gteHardfork('testnet-hf1') ? ConsensusType.Reimint : ConsensusType.Clique;
  } else if (common.chainName() === 'gxc2-mainnet') {
    return common.gteHardfork('mainnet-hf1') ? ConsensusType.Reimint : ConsensusType.Clique;
  } else {
    throw new Error('unknown chain');
  }
}

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
 * Generate receipt root after `hf1`
 * @param transactions - List of transaction
 * @param receipts - List of receipt
 * @returns Receipt root
 */
export async function genReceiptTrie(transactions: TypedTransaction[], receipts: TxReceipt[]) {
  const trie = new BaseTrie();
  for (let i = 0; i < receipts.length; i++) {
    await trie.put(rlp.encode(i), encodeReceipt(transactions[i], receipts[i]));
  }
  return trie.root;
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
