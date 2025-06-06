import fs from 'fs';
import path from 'path';
import PeerId from 'peer-id';
import { Address, BN } from 'ethereumjs-util';
import { hexStringToBuffer, logger } from '@rei-network/utils';
import { EVMWorkMode } from '@rei-network/vm/dist/evm/evm';
import { SyncMode } from './sync';
import { Node } from './node';

export interface CreateNodeOptions {
  /**
   * Unlock account list,
   * [[address, passphrase], [address, passphrase], ...]
   */
  unlock: [string, string][];
  /**
   * BLS private key file name
   */
  blsFileName?: string;
  /**
   * BLS private key file password
   */
  blsPassword?: string;
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
  evmWorkMode?: string;
  /**
   * Whether skip verifing snapshot
   */
  skipVerifySnap?: boolean;
  /**
   * Miner address
   */
  coinbase?: string;
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
  syncMode?: string;
  /**
   * Snap sync min total difficulty
   */
  snapSyncMinTD?: number;
  /**
   * Trusted height
   */
  trustedHeight?: string;
  /**
   * Trusted block hash
   */
  trustedHash?: string;
}

async function loadPeerId(databasePath: string) {
  let peerId!: PeerId;
  const nodeKeyPath = path.join(databasePath, 'nodekey');
  try {
    const key = fs.readFileSync(nodeKeyPath);
    peerId = await PeerId.createFromPrivKey(key);
  } catch (err) {
    logger.warn('Read nodekey faild, generate a new key');
    peerId = await PeerId.create({ keyType: 'secp256k1' });
    fs.writeFileSync(nodeKeyPath, peerId.privKey.bytes);
  }
  return peerId;
}

export abstract class NodeFactory {
  static async createNode(options: CreateNodeOptions) {
    // create node
    const node = new Node({
      ...options,
      peerId: await loadPeerId(options.databasePath),
      coinbase: options.coinbase
        ? Address.fromString(options.coinbase)
        : undefined,
      evmWorkMode: (() => {
        if (options.evmWorkMode === undefined) {
          return undefined;
        }
        if (
          options.evmWorkMode !== EVMWorkMode.JS &&
          options.evmWorkMode !== EVMWorkMode.Binding
        ) {
          throw new Error(`invalid EVM work mode: ${options.evmWorkMode}`);
        }
        return options.evmWorkMode;
      })(),
      syncMode: (() => {
        if (options.syncMode === undefined) {
          return undefined;
        }
        if (
          options.syncMode !== SyncMode.Full &&
          options.syncMode !== SyncMode.Snap
        ) {
          throw new Error(`invalid sync mode: ${options.syncMode}`);
        }
        return options.syncMode;
      })(),
      trustedHeight: options.trustedHeight
        ? new BN(options.trustedHeight)
        : undefined,
      trustedHash: options.trustedHash
        ? hexStringToBuffer(options.trustedHash)
        : undefined
    });

    // unlock ECDSA private keys
    const unlock = options.unlock;
    if (unlock.length > 0) {
      const result = await Promise.all(
        unlock.map(([address, passphrase]) =>
          node.accMngr.unlock(address, passphrase)
        )
      );
      for (let i = 0; i < result.length; i++) {
        if (!result[i]) {
          throw new Error(`unlock account ${unlock[i][0]} failed!`);
        }
      }
    }

    // unlock BLS private keys
    if (options.blsFileName) {
      if (!options.blsPassword) {
        throw new Error('please provide bls password');
      }
      await node.blsMngr.unlock(options.blsFileName, options.blsPassword);
    }

    // initialize node
    await node.init();

    // start node
    node.start();

    return node;
  }
}
