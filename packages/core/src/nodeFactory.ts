import fs from 'fs';
import path from 'path';
import PeerId from 'peer-id';
import { logger } from '@rei-network/utils';
import { NetworkManagerOptions } from '@rei-network/network';
import { ConsensusEngineOptions } from './consensus/types';
import { SynchronizerOptions } from './sync';
import { Node } from './node';
import { NodeOptions, AccountManagerConstructorOptions } from './types';

export interface MineOptions extends Omit<ConsensusEngineOptions, 'node'> {}

export interface NetworkOptions extends Omit<NetworkManagerOptions, 'protocols' | 'nodedb' | 'datastore' | 'peerId'> {}

export interface AccountOptions extends AccountManagerConstructorOptions {
  /**
   * Unlock account list,
   * [[address, passphrase], [address, passphrase], ...]
   */
  unlock: [string, string][];
}

export interface SyncOptions extends Omit<SynchronizerOptions, 'node'> {}

export interface CreateNodeOptions extends Omit<NodeOptions, 'mine' | 'network' | 'account'> {
  mine: MineOptions;
  network: NetworkOptions;
  account: AccountOptions;
  sync: SyncOptions;
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
    const node = new Node({
      ...options,
      network: {
        ...options.network,
        peerId: await loadPeerId(options.databasePath)
      }
    });

    const unlock = options.account.unlock;
    if (unlock.length > 0) {
      const result = await Promise.all(unlock.map(([address, passphrase]) => node.accMngr.unlock(address, passphrase)));
      for (let i = 0; i < result.length; i++) {
        if (!result[i]) {
          throw new Error(`Unlock account ${unlock[i][0]} failed!`);
        }
      }
    }
    const coinbase = options.mine.coinbase;
    if (coinbase && !node.accMngr.hasUnlockedAccount(coinbase)) {
      throw new Error(`Unlock coinbase account ${coinbase.toString()} failed!`);
    }

    return node;
  }
}
