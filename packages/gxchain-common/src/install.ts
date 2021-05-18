import { hardforks as EthereumHF } from '@ethereumjs/common/dist/hardforks';
import { EIPs } from '@ethereumjs/common/dist/eips';
import { hardforks } from './hardforks';
import { GIPs } from './gips';

// custom hardforks.
for (const hf of hardforks) {
  EthereumHF.push(hf);
}

// custom gips.
for (const gip of Object.keys(GIPs)) {
  Object.defineProperty(EIPs, gip, {
    value: GIPs[gip],
    writable: false,
    enumerable: true
  });
}