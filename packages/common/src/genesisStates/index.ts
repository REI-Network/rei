import { genesisStatesType } from './../types';

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

/**
 * Returns the genesis state by network ID
 * @param id ID of the network (e.g. 1)
 * @returns Dictionary with genesis accounts
 */
export function genesisStateById(id: number): any {
  return genesisStates[genesisStates['names'][id]];
}

/**
 * Returns the genesis state by network name
 * @param name Name of the network (e.g. 'mainnet')
 * @returns Dictionary with genesis accounts
 */
export function genesisStateByName(name: string): any {
  return genesisStates[name];
}
