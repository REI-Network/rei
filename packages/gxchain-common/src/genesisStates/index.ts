import { genesisStatesType } from '@ethereumjs/common/dist/types';

const genesisStates: genesisStatesType = {
  names: {
    '12358': 'gxc2'
  },
  gxc2: require('./mainnet.json')
};

export function getGenesisState(name: number | string) {
  return typeof name === 'string' ? genesisStates[name] : genesisStates[genesisStates['names'][name]];
}
