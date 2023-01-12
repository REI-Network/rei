import { NetworkManagerOptions } from '@rei-network/network';
import { Receipt, Block } from '@rei-network/structure';
import { ConsensusEngineOptions } from './consensus/types';

export interface ConsensusEngineConstructorOptions extends Omit<ConsensusEngineOptions, 'node'> {}

export interface NetworkManagerConstructorOptions extends Omit<NetworkManagerOptions, 'protocols' | 'nodedb'> {}

export interface AccountManagerConstructorOptions {
  /**
   * Keystore full path
   */
  keyStorePath: string;
}

export interface BlsManagerConstructorOptions {
  bls: string;
}

export interface NodeOptions {
  /**
   * Full path of database
   */
  databasePath: string;
  /**
   * Chain name, default is `rei-mainnet`
   */
  chain?: string;
  /**
   * Max receipts cache size
   */
  receiptsCacheSize?: number;
  /**
   * Evm implementation type
   */
  evm?: string;

  mine: ConsensusEngineConstructorOptions;
  network: NetworkManagerConstructorOptions;
  account: AccountManagerConstructorOptions;
  bls: BlsManagerConstructorOptions;
}

export type NodeStatus = {
  networkId: number;
  totalDifficulty: Buffer;
  height: number;
  bestHash: Buffer;
  genesisHash: Buffer;
};

export interface CommitBlockOptions {
  broadcast: boolean;
  block: Block;
  receipts: Receipt[];
}
