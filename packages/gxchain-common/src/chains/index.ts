import { chainsType } from '@ethereumjs/common/dist/types';

const chains: chainsType = {
  names: {
    '12358': 'gxc2'
  },
  gxc2: require('./mainnet.json')
};

export function getChain(name: number | string) {
  return typeof name === 'string' ? chains[name] : chains[chains['names'][name]];
}
