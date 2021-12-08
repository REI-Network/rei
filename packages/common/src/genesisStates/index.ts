import { genesisStatesType } from '@gxchain2-ethereumjs/common/dist/types';

const genesisStates: genesisStatesType = {
  names: {
    '47805': 'rei-mainnet',
    '12357': 'rei-testnet',
    '23579': 'rei-devnet'
  },
  'rei-mainnet': require('./mainnet.json'),
  'rei-testnet': require('./testnet.json'),
  'rei-devnet': require('./devnet.json')
};

export function getGenesisState(name: number | string) {
  return typeof name === 'string' ? genesisStates[name] : genesisStates[genesisStates['names'][name]];
}
