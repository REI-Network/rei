import { Address, BN } from 'ethereumjs-util';
import { Common } from '@rei-network/common';

export const genesisValidatorVotingPower = new BN(1);
export const genesisValidatorPriority = new BN(1);

// genesis validators
let genesisValidators: Address[] | undefined;

export function getGenesisValidators(common: Common) {
  // get genesis validators from common
  if (!genesisValidators) {
    genesisValidators = common
      .param('vm', 'genesisValidators')
      .map((addr) => Address.fromString(addr)) as Address[];
    // sort by address
    genesisValidators.sort((a, b) => a.buf.compare(b.buf) as 1 | -1 | 0);
  }
  return [...genesisValidators];
}

export function isGenesis(validator: Address, common: Common) {
  const gvs = getGenesisValidators(common);
  return gvs.findIndex((gv) => gv.equals(validator)) !== -1;
}
