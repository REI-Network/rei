import { rlphash } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { BlockHeader, HashFunction, setCustomHashFunction, CLIQUE_EXTRA_VANITY } from '@rei-network/structure';
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
  if (common.chainName() === 'rei-testnet') {
    return ConsensusType.Reimint;
  } else if (common.chainName() === 'rei-mainnet') {
    return ConsensusType.Reimint;
  } else if (common.chainName() === 'rei-devnet') {
    return ConsensusType.Reimint;
  } else {
    throw new Error('unknown chain');
  }
}

/**
 * Check whether reimint logic is enabled
 * @param common - Common instance
 * @returns Enable if `true`
 */
export function isEnableRemint(common: Common) {
  if (common.chainName() === 'rei-testnet') {
    return true;
  } else if (common.chainName() === 'rei-mainnet') {
    return true;
  } else if (common.chainName() === 'rei-devnet') {
    return true;
  } else {
    throw new Error('unknown chain');
  }
}

/**
 * Check whether free staking logic is enabled
 * @param common - Common instance
 * @returns Enable if `true`
 */
export function isEnableFreeStaking(common: Common) {
  if (common.chainName() === 'rei-testnet') {
    if (common.gteHardfork('testnet-hf-1')) {
      return true;
    } else {
      return false;
    }
  } else if (common.chainName() === 'rei-mainnet') {
    return false;
  } else if (common.chainName() === 'rei-devnet') {
    return false;
  } else {
    throw new Error('unknown chain');
  }
}
