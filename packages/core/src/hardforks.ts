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
 * Check whether free staking logic is enabled
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

export function isEnableValidatorsIndex(common: Common) {
  if (common.chainName() === 'rei-testnet') {
    return common.gteHardfork('validators-index');
  } else if (common.chainName() === 'rei-mainnet') {
    return common.gteHardfork('validators-index');
  } else if (common.chainName() === 'rei-devnet') {
    return common.gteHardfork('validators-index');
  } else {
    throw new Error('unknown chain');
  }
}
