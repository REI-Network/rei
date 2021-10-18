import { TxReceipt } from '@gxchain2-ethereumjs/vm/dist/types';
import { encodeReceipt } from '@gxchain2-ethereumjs/vm/dist/runBlock';
import { BaseTrie } from 'merkle-patricia-tree';
import { rlphash, toBuffer } from 'ethereumjs-util';
import { Common } from '@gxchain2/common';
import { TypedTransaction, BlockHeader, HashFunction, setCustomHashFunction, CLIQUE_EXTRA_VANITY } from '@gxchain2/structure';
import { ConsensusType } from '../consensus/types';
import { BlockHeader_hash } from '../consensus/reimint/extraData';

const customHashFunction: HashFunction = (header: BlockHeader) => {
  if (header.extraData.length <= CLIQUE_EXTRA_VANITY || getConsensusTypeByHeader(header) === ConsensusType.Clique) {
    return rlphash(header.raw());
  } else {
    return BlockHeader_hash(header);
  }
};

setCustomHashFunction(customHashFunction);

export function getConsensusTypeByCommon(common: Common) {
  if (common.chainName() === 'gxc2-testnet') {
    return common.gteHardfork('testnet-hf1') ? ConsensusType.Reimint : ConsensusType.Clique;
  } else if (common.chainName() === 'gxc2-mainnet') {
    return common.gteHardfork('mainnet-hf1') ? ConsensusType.Reimint : ConsensusType.Clique;
  } else {
    throw new Error('unknown chain');
  }
}

export function getConsensusTypeByHeader(header: BlockHeader) {
  let parentConsensusType: ConsensusType | undefined;
  if (header.number.gtn(0)) {
    const common = header._common.copy();
    common.setHardforkByBlockNumber(header.number.subn(1));
    parentConsensusType = getConsensusTypeByCommon(common);
  }
  const consensusType = getConsensusTypeByCommon(header._common);
  if ((parentConsensusType === ConsensusType.Clique && consensusType === ConsensusType.Reimint) || consensusType === ConsensusType.Clique) {
    return ConsensusType.Clique;
  } else {
    return ConsensusType.Reimint;
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
