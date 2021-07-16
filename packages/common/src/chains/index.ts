import { chainsType } from '@ethereumjs/common/dist/types';

const chains: chainsType = {
  names: {
    '12358': 'gxc2-mainnet',
    '12357': 'gxc2-testnet'
  },
  'gxc2-mainnet': require('./mainnet.json'),
  'gxc2-testnet': require('./testnet.json')
};

export function getChain(name: number | string) {
  return typeof name === 'string' ? chains[name] : chains[chains['names'][name]];
}
