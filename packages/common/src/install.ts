import { hardforks as EthereumHF } from '@gxchain2-ethereumjs/common/dist/hardforks';
import { EIPs } from '@gxchain2-ethereumjs/common/dist/eips';
import { hardforks } from './hardforks';
import { RIPs } from './rips';

// custom hardforks.
for (const hf of hardforks) {
  EthereumHF.push(hf);
}

// custom gips.
for (const gip of Object.keys(RIPs)) {
  Object.defineProperty(EIPs, gip, {
    value: RIPs[gip],
    writable: false,
    enumerable: true
  });
}
