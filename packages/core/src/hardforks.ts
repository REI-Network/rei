import { rlphash, Address, BN, setLengthRight, setLengthLeft } from 'ethereumjs-util';
import { addPrecompile, PrecompileAvailabilityCheck } from '@rei-network/vm/dist/evm/precompiles';
import { OOGResult } from '@rei-network/vm/dist/evm/evm';
import { hexStringToBN } from '@rei-network/utils';
import { Common } from '@rei-network/common';
import { BlockHeader, setCustomHashFunction, CLIQUE_EXTRA_VANITY } from '@rei-network/structure';
import { StateManager } from './stateManager';
import { ConsensusType } from './consensus/types';
import { Reimint } from './consensus/reimint/reimint';
import { Fee } from './consensus/reimint/contracts';
import { bufferToAddress } from './consensus/reimint/contracts/utils';
const assert = require('assert');

/**
 * Set custom block hash function
 */
setCustomHashFunction((header: BlockHeader) => {
  if (header.extraData.length <= CLIQUE_EXTRA_VANITY || getConsensusTypeByCommon(header._common) === ConsensusType.Clique) {
    return rlphash(header.raw());
  } else {
    return Reimint.calcBlockHash(header);
  }
});

/**
 * Add estimate fee precompile function
 */
addPrecompile(
  Address.fromString('0x00000000000000000000000000000000000000ff'),
  async (opts) => {
    assert(opts.data);

    const gasUsed = new BN(opts._common.param('gasPrices', 'estimateFee'));

    if (opts.gasLimit.lt(gasUsed)) {
      return OOGResult(opts.gasLimit);
    }

    const data = setLengthRight(opts.data, 64);
    const address = bufferToAddress(data.slice(0, 32));
    const timestamp = new BN(data.slice(32, 64));

    const state = opts._VM.stateManager as StateManager;
    const totalAmount = await Fee.getTotalAmount(state);
    const dailyFee = hexStringToBN(state._common.param('vm', 'dailyFee'));
    const stakeInfo = (await state.getAccount(address)).getStakeInfo();
    const fee = stakeInfo.estimateFee(timestamp.toNumber(), totalAmount, dailyFee);

    return {
      gasUsed,
      returnValue: setLengthLeft(fee.toBuffer(), 32)
    };
  },
  {
    type: PrecompileAvailabilityCheck.Hardfork,
    param: 'free-staking'
  }
);

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
 * Check whether hardfork1 logic is enabled
 * @param common - Common instance
 * @returns Enable if `true`
 */
export function isEnableHardfork1(common: Common) {
  if (common.chainName() === 'rei-testnet') {
    return common.gteHardfork('testnet-hf-1');
  } else if (common.chainName() === 'rei-mainnet') {
    return common.gteHardfork('mainnet-hf-1');
  } else if (common.chainName() === 'rei-devnet') {
    return false;
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
    return common.gteHardfork('free-staking');
  } else if (common.chainName() === 'rei-mainnet') {
    return common.gteHardfork('free-staking');
  } else if (common.chainName() === 'rei-devnet') {
    return common.gteHardfork('free-staking');
  } else {
    throw new Error('unknown chain');
  }
}

/**
 * Check whether better POS is enabled
 * @param common - Common instance
 * @returns Enable if `true`
 */
export function isEnableHardfork2(common: Common) {
  if (common.chainName() === 'rei-testnet') {
    return common.gteHardfork('testnet-hf-2');
  } else if (common.chainName() === 'rei-mainnet') {
    return common.gteHardfork('mainnet-hf-2');
  } else if (common.chainName() === 'rei-devnet') {
    return false;
  } else {
    throw new Error('unknown chain');
  }
}

/**
 * Load init data for hardfork 2
 * @param common - Common instance
 * @returns Init data
 */
export function loadInitData(common: Common): undefined | { initHeight: number; initHashes: string[] } {
  common = common.copy();
  if (isEnableHardfork2(common)) {
    // it looks like hf2 is enabled,
    // there is no need to collect hashes anymore
    return;
  }

  function isActiveHardfork(hardforks: { name: string }[], hardfork: string) {
    return hardforks.filter(({ name }) => name === hardfork).length > 0;
  }

  // set hardfork to get init data
  if (common.chainName() === 'rei-mainnet') {
    if (isActiveHardfork(common.activeHardforks(), 'mainnet-hf-2')) {
      common.setHardfork('mainnet-hf-2');
    } else {
      return;
    }
  } else if (common.chainName() === 'rei-testnet') {
    if (isActiveHardfork(common.activeHardforks(), 'testnet-hf-2')) {
      common.setHardfork('testnet-hf-2');
    } else {
      return;
    }
  } else {
    // collector only work on mainnet and testnet
    return;
  }

  // load init height from common
  const initHeight = common.param('vm', 'initHeight');
  if (typeof initHeight !== 'number') {
    throw new Error('invalid initHeight');
  }

  // load init hashes from common
  const initHashes = common.param('vm', 'initHashes');
  if (!Array.isArray(initHashes)) {
    throw new Error('invalid initHashes');
  }

  return { initHeight, initHashes };
}

/**
 * Check whether better POS is enabled
 * @param common - Common instance
 * @returns Enable if `true`
 */
export function isEnableBetterPOS(common: Common) {
  if (common.chainName() === 'rei-testnet') {
    return common.gteHardfork('better-pos');
  } else if (common.chainName() === 'rei-mainnet') {
    return common.gteHardfork('better-pos');
  } else if (common.chainName() === 'rei-devnet') {
    return common.gteHardfork('better-pos');
  } else {
    throw new Error('unknown chain');
  }
}

export function isEnableFeatEvidence(common: Common) {
  if (common.chainName() === 'rei-testnet') {
    return common.gteHardfork('feat-evidence');
  } else if (common.chainName() === 'rei-mainnet') {
    return common.gteHardfork('feat-evidence');
  } else if (common.chainName() === 'rei-devnet') {
    return common.gteHardfork('feat-evidence');
  } else {
    throw new Error('unknown chain');
  }
}
