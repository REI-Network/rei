import { chainsType } from '@gxchain2-ethereumjs/common/dist/types';

const chains: chainsType = {
  names: {
    '47805': 'gxc2-mainnet',
    '12357': 'gxc2-testnet',
    '23579': 'gxc2-devnet'
  },
  'gxc2-mainnet': require('./mainnet.json'),
  'gxc2-testnet': require('./testnet.json'),
  'gxc2-devnet': require('./devnet.json')
};

export function getChain(name: number | string) {
  return typeof name === 'string' ? chains[name] : chains[chains['names'][name]];
}
