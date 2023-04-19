import { Address, BN, toBuffer } from 'ethereumjs-util';
import { Common } from '@rei-network/common';

export const genesisValidatorVotingPower = new BN(1);
export const genesisValidatorPriority = new BN(1);

// genesis validators
let genesisValidators: Address[] | undefined;

export function getGenesisValidators(common: Common) {
  // get genesis validators from common
  if (!genesisValidators) {
    genesisValidators = common.param('vm', 'genesisValidators').map((addr) => Address.fromString(addr)) as Address[];
    // sort by address
    genesisValidators.sort((a, b) => a.buf.compare(b.buf) as 1 | -1 | 0);
  }
  return [...genesisValidators];
}

// genesis validator bls infos
const genesisBlsPublicKey = new Map<string, Map<string, string>>([
  [
    'rei-devnet',
    new Map<string, string>([
      ['0xff96a3bff24da3d686fea7bd4beb5ccfd7868dde', '0xe4f75966f66de932f8588d7e43cebffa72b94959e7f2b25ab467528857f143fefd49e2321da1cd8d819e5ef4a4cd18a3'],
      ['0x809fae291f79c9953577ee9007342cff84014b1c', '0xb075545c9343c3c77b55c235c70498e3a778e650d3b41119135264d1f18af4c1b4d2d6652a86e74239a8e6c895dcffd4'],
      ['0x57b80007d142297bc383a741e4c1dd18e4c75754', '0xece169fa620dbe26eba06cf16d32eb9ce62b1b3f21208126ab27ee75f7d1a22e0a04f2c641f43440d28015c29a5f8b2c']
    ])
  ]
]);

export function getGenesisBlsPublicKey(validator: Address, common: Common) {
  const pk = genesisBlsPublicKey.get(common.chainName())?.get(validator.toString());
  if (!pk) {
    throw new Error('missing genesis validator public key');
  }
  return toBuffer(pk);
}

export function isGenesis(validator: Address, common: Common) {
  const gvs = getGenesisValidators(common);
  return gvs.findIndex((gv) => gv.equals(validator)) !== -1;
}
