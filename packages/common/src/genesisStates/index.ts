import { genesisStatesType } from '@gxchain2-ethereumjs/common/dist/types';

const genesisStates: genesisStatesType = {
  names: {
    '12358': 'gxc2-mainnet',
    '12357': 'gxc2-testnet'
  },
  'gxc2-mainnet': require('./mainnet.json'),
  'gxc2-testnet': require('./testnet.json')
};

export function getGenesisState(name: number | string) {
  return typeof name === 'string' ? genesisStates[name] : genesisStates[genesisStates['names'][name]];
}
