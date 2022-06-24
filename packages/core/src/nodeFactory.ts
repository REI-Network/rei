import fs from 'fs';
import path from 'path';
import PeerId from 'peer-id';
import { Address } from 'ethereumjs-util';
import { logger } from '@rei-network/utils';
import { NetworkManagerOptions } from '@rei-network/network';
import { ConsensusEngineOptions } from './consensus/types';
import { Node } from './node';
import { NodeOptions, AccountManagerConstructorOptions } from './types';

export interface MineOptions extends Omit<ConsensusEngineOptions, 'node' | 'coinbase'> {
  coinbase: string;
}

export interface NetworkOptions extends Omit<NetworkManagerOptions, 'protocols' | 'nodedb' | 'peerId'> { }

export interface AccountOptions extends AccountManagerConstructorOptions {
  /**
   * Unlock account list,
   * [[address, passphrase], [address, passphrase], ...]
   */
  unlock: [string, string][];
}

export interface CreateNodeOptions extends Omit<NodeOptions, 'mine' | 'network' | 'account'> {
  mine: MineOptions;
  network: NetworkOptions;
  account: AccountOptions;
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

export class NodeFactory {
  // disable constructor
  private constructor() { }

  static async createNode(options: CreateNodeOptions) {
    const coinbase = options.mine.coinbase ? Address.fromString(options.mine.coinbase) : undefined;
    const node = new Node({
      ...options,
      mine: {
        ...options.mine,
        coinbase
      },
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
    if (coinbase && !node.accMngr.hasUnlockedAccount(coinbase)) {
      throw new Error(`Unlock coinbase account ${coinbase.toString()} failed!`);
    }

    await node.init();
    node.start();
    return node;
  }
}
