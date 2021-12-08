import { chainsType } from '@gxchain2-ethereumjs/common/dist/types';

const chains: chainsType = {
  names: {
    '47805': 'rei-mainnet',
    '12357': 'rei-testnet',
    '23579': 'rei-devnet'
  },
  'rei-mainnet': require('./mainnet.json'),
  'rei-testnet': require('./testnet.json'),
  'rei-devnet': require('./devnet.json')
};

export function getChain(name: number | string) {
  return typeof name === 'string' ? chains[name] : chains[chains['names'][name]];
}
