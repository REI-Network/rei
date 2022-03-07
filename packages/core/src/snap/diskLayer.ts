import { BaseTrie as Trie } from 'merkle-patricia-tree';
import { Database } from '@rei-network/database';
import { FunctionalBufferSet } from '@rei-network/utils';
import { StakingAccount } from '../stateManager';
import { DiffLayer } from './diffLayer';
import { ISnapshot, AccountData, StorageData } from './types';

export class DiskLayer implements ISnapshot {
  readonly db: Database;
  readonly trie: Trie;
  readonly root: Buffer;
  readonly parent = undefined;

  stale: boolean = false;
  genMarker?: Buffer;

  constructor(db: Database, trie: Trie, root: Buffer) {
    this.db = db;
    this.trie = trie;
    this.root = root;
  }

  /**
   * Get account object
   * @param accountHash - Account hash
   * @returns Account object
   */
  async getAccount(accountHash: Buffer) {
    return StakingAccount.fromRlpSerializedSlimAccount(await this.getSerializedAccount(accountHash));
  }

  /**
   * Get serialized account by account hash
   * @param hash - Account hash
   * @returns Serialized account
   */
  getSerializedAccount(accountHash: Buffer) {
    if (this.stale) {
      throw new Error('stale disk layer');
    }

    if (this.genMarker && this.genMarker.compare(accountHash) < 0) {
      throw new Error('incomplete snapshot');
    }

    return this.db.getSerializedSnapAccount(accountHash);
  }

  /**
   * Get storage data
   * @param accountHash - Account hash
   * @param storageHash - Storage hash
   * @returns Storage data
   */
  getStorage(accountHash: Buffer, storageHash: Buffer) {
    if (this.stale) {
      throw new Error('stale disk layer');
    }

    const key = Buffer.concat([accountHash, storageHash]);
    if (this.genMarker && this.genMarker.compare(key) < 0) {
      throw new Error('incomplete snapshot');
    }

    return this.db.getSnapStorage(accountHash, storageHash);
  }

  /**
   * Creates a new diff layer on top of the this layer
   * @param root - Root hash
   * @param destructSet - Destruct account set
   * @param accountData - Modified account data
   * @param storageData - Modified storage data
   * @returns New layer
   */
  update(root: Buffer, destructSet: FunctionalBufferSet, accountData: AccountData, storageData: StorageData) {
    return DiffLayer.createDiffLayerFromParent(this, root, destructSet, accountData, storageData);
  }
}
