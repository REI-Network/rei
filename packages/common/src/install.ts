import { hardforks as EthereumHF } from '@gxchain2-ethereumjs/common/dist/hardforks';
import { EIPs } from '@gxchain2-ethereumjs/common/dist/eips';
import { hardforks } from './hardforks';
import { RIPs } from './rips';

// custom hardforks.
for (const hf of hardforks) {
  EthereumHF.push(hf);
}

// custom rips.
for (const rip of Object.keys(RIPs)) {
  Object.defineProperty(EIPs, rip, {
    value: RIPs[rip],
    writable: false,
    enumerable: true
  });
}
