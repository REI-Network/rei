import { chainsType } from './../types';

/**
 * @hidden
 */
export const chains: chainsType = {
  names: {
    '47805': 'rei-mainnet',
    '12357': 'rei-testnet',
    '23579': 'rei-devnet'
  },
  'rei-mainnet': require('./mainnet.json'),
  'rei-testnet': require('./testnet.json'),
  'rei-devnet': require('./devnet.json')
};
