import { rlphash } from 'ethereumjs-util';
import { Common } from '@gxchain2/common';
import { BlockHeader, HashFunction, setCustomHashFunction, CLIQUE_EXTRA_VANITY } from '@gxchain2/structure';
import { ConsensusType } from './consensus/types';
import { Reimint } from './consensus/reimint/reimint';

const customHashFunction: HashFunction = (header: BlockHeader) => {
  if (header.extraData.length <= CLIQUE_EXTRA_VANITY || getConsensusTypeByCommon(header._common) === ConsensusType.Clique) {
    return rlphash(header.raw());
  } else {
    return Reimint.calcBlockHash(header);
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
