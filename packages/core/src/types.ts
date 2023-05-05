import type { Address, BN } from 'ethereumjs-util';
import type PeerId from 'peer-id';
import type { EVMWorkMode } from '@rei-network/vm/dist/evm/evm';
import type { SyncMode } from './sync';

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
  /*
   * Evm implementation type
   */
  evmWorkMode?: EVMWorkMode;
  /**
   * Whether skip verifing snapshot
   */
  skipVerifySnap?: boolean;
  /**
   * Miner address
   */
  coinbase?: Address;
  /**
   * Peer id
   */
  peerId: PeerId;
  /**
   * P2P TCP port
   */
  tcpPort?: number;
  /**
   * P2p UDP port
   */
  udpPort?: number;
  /**
   * Boot nodes list
   */
  bootnodes?: string[];
  /**
   * Keystore full path
   */
  keyStorePath: string;
  /**
   * BLS file path
   */
  blsPath: string;
  /**
   * Sync mode
   */
  syncMode?: SyncMode;
  /**
   * Snap sync min total difficulty
   */
  snapSyncMinTD?: number;
  /**
   * Trusted height
   */
  trustedHeight?: BN;
  /**
   * Trusted block hash
   */
  trustedHash?: Buffer;
}

export type NodeStatus = {
  networkId: number;
  totalDifficulty: Buffer;
  height: number;
  bestHash: Buffer;
  genesisHash: Buffer;
};
