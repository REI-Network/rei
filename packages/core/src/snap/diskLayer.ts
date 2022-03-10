import { Database } from '@rei-network/database';
import { snapStorageKey, snapAccountKey, SNAP_ACCOUNT_PREFIX, SNAP_STORAGE_PREFIX } from '@rei-network/database/dist/constants';
import { FunctionalBufferSet } from '@rei-network/utils';
import { StakingAccount } from '../stateManager';
import { MAX_HASH } from '../utils';
import { DiffLayer } from './diffLayer';
import { asyncTraverseRawDB } from './iterator';
import { ISnapshot, AccountData, StorageData } from './types';

export class DiskLayer implements ISnapshot {
  readonly db: Database;
  readonly root: Buffer;
  readonly parent = undefined;

  stale: boolean = false;
  genMarker?: Buffer;

  constructor(db: Database, root: Buffer) {
    this.db = db;
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

  /**
   * Generates an iterator that traverses all accounts on disk
   * @param seek - Point to start traversing
   * @returns Iterator
   */
  genAccountIterator(seek: Buffer) {
    return asyncTraverseRawDB(
      this.db.rawdb,
      { gte: snapAccountKey(seek), lte: snapAccountKey(MAX_HASH) },
      (key) => key.length !== SNAP_ACCOUNT_PREFIX.length + 32,
      (key) => key.slice(SNAP_STORAGE_PREFIX.length),
      (value) => StakingAccount.fromRlpSerializedSlimAccount(value)
    );
  }

  /**
   * Generates an iterator that traverses all storage data on disk for the target account
   * @param accountHash - Target account hash
   * @param seek - Point to start traversing
   * @returns Iterator
   */
  genStorageIterator(accountHash: Buffer, seek: Buffer) {
    return {
      iter: asyncTraverseRawDB(
        this.db.rawdb,
        { gte: snapStorageKey(accountHash, seek), lte: snapStorageKey(accountHash, MAX_HASH) },
        (key) => key.length !== SNAP_STORAGE_PREFIX.length + 32 + 32,
        (key) => key.slice(SNAP_STORAGE_PREFIX.length + 32),
        (value) => value
      ),
      destructed: false
    };
  }

  /**
   * Persist self to disk
   * @param output - Output array
   * @returns Disk layer root hash
   */
  journal(output: any[]): Buffer {
    // TODO: journalProgress

    if (this.stale) {
      throw new Error('stale disk layer');
    }

    output.push(this.root);

    return this.root;
  }
}
