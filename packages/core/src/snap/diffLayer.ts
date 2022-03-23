import { FunctionalBufferMap, FunctionalBufferSet } from '@rei-network/utils';
import Bloom from '@rei-network/vm/dist/bloom';
import { StakingAccount } from '../stateManager';
import { DiskLayer } from './diskLayer';
import { asyncTraverseHashList } from './layerIterator';
import { ISnapshot, Snapshot, DestructSet, AccountData, StorageData } from './types';

/**
 * TODO: improve
 */
class DiffBloom extends Bloom {
  copy() {
    return new DiffBloom(Buffer.from(this.bitvector));
  }
}

export class DiffLayer implements ISnapshot {
  readonly origin: DiskLayer;
  readonly root: Buffer;
  readonly diffed: DiffBloom;
  readonly memory: number;
  readonly parent: Snapshot;

  readonly destructSet: DestructSet;
  readonly accountData: AccountData;
  readonly storageData: StorageData;

  stale: boolean = false;

  private accountList?: Buffer[];
  private storageList?: FunctionalBufferMap<Buffer[]>;

  /**
   * Create a diff layer from parent layer
   * @param parent - Parent layer
   * @param root - Root hash
   * @param destructSet - Destruct account set
   * @param accountData - Modified account data
   * @param storageData - Modified storage data
   * @returns New diff layer
   */
  static createDiffLayerFromParent(parent: Snapshot, root: Buffer, destructSet: DestructSet, accountData: AccountData, storageData: StorageData) {
    let diffed: DiffBloom;
    if (parent instanceof DiffLayer) {
      // if the parent layer is a diff layer, copy the bloom from it
      diffed = parent.diffed.copy();
    } else {
      // otherwise, create an empty one
      diffed = new DiffBloom();
    }

    // calculate memory usage
    let memory = 0;
    for (const [, data] of accountData) {
      memory += 32 + data.length;
    }
    for (const [, storage] of storageData) {
      for (const [, data] of storage) {
        memory += 32 + data.length;
      }
    }
    memory += destructSet.size * 32;

    const dl = new DiffLayer(parent, root, destructSet, accountData, storageData, diffed, memory);
    dl.rebloom();

    return dl;
  }

  constructor(parent: Snapshot, root: Buffer, destructSet: FunctionalBufferSet, accountData: AccountData, storageData: StorageData, diffed: DiffBloom, memory: number) {
    this.parent = parent;
    this.root = root;
    this.origin = parent instanceof DiskLayer ? parent : parent.origin;
    this.destructSet = destructSet;
    this.accountData = accountData;
    this.storageData = storageData;
    this.diffed = diffed;
    this.memory = memory;
  }

  /**
   * Calculate new bloom based on parent bloom
   */
  private rebloom() {
    for (const hash of this.destructSet) {
      this.diffed.add(hash);
    }
    for (const [hash] of this.accountData) {
      this.diffed.add(hash);
    }
    for (const [accountHash, storage] of this.storageData) {
      for (const [storageHash] of storage) {
        this.diffed.add(Buffer.concat([accountHash, storageHash]));
      }
    }
  }

  /**
   * Get account object by account hash
   * @param hash - Account hash
   * @returns Account object or null
   */
  async getAccount(hash: Buffer): Promise<StakingAccount | null> {
    const serializedAccount = await this.getSerializedAccount(hash);
    return serializedAccount && StakingAccount.fromRlpSerializedSlimAccount(serializedAccount);
  }

  /**
   * Get serialized account by account hash
   * @param hash - Account hash
   * @returns Serialized account or null
   */
  getSerializedAccount(hash: Buffer): Promise<Buffer | null> {
    if (this.diffed.check(hash)) {
      // if the bloom matches, load data from itself or parent layer
      return this._getSerializedAccount(hash);
    }

    // otherwise, directly load data from disk layer
    return this.origin.getSerializedAccount(hash);
  }

  /**
   * Get serialized account from itself or parent layer
   * @param hash - Account hash
   * @returns Serialized account or null
   */
  private _getSerializedAccount(hash: Buffer): Promise<Buffer | null> {
    if (this.stale) {
      throw new Error('stale diff layer');
    }

    const data = this.accountData.get(hash);
    if (data) {
      // account data exists, return
      return Promise.resolve(data);
    }

    if (this.destructSet.has(hash)) {
      // account has been deleted, return null
      return Promise.resolve(null);
    }

    if (this.parent instanceof DiffLayer) {
      // if parent is a diff layer, try to load account data from parent
      return this.parent._getSerializedAccount(hash);
    }

    // otherwise, load from disk
    return this.parent.getSerializedAccount(hash);
  }

  /**
   * Get storage data
   * @param accountHash - Account hash
   * @param storageHash - Storage hash
   * @returns Storage data
   */
  getStorage(accountHash: Buffer, storageHash: Buffer): Promise<Buffer> {
    if (this.diffed.check(Buffer.concat([accountHash, storageHash]))) {
      return this._getStorage(accountHash, storageHash);
    }

    return this.origin.getStorage(accountHash, storageHash);
  }

  /**
   * Get storage data from itself or parent layer
   * @param accountHash - Account hash
   * @param storageHash - Storage hash
   * @returns storage data
   */
  private _getStorage(accountHash: Buffer, storageHash: Buffer): Promise<Buffer> {
    if (this.stale) {
      throw new Error('stale diff layer');
    }

    const storageValue = this.storageData.get(accountHash)?.get(storageHash);
    if (storageValue) {
      return Promise.resolve(storageValue);
    }

    if (this.parent instanceof DiffLayer) {
      return this.parent._getStorage(accountHash, storageHash);
    }

    return this.parent.getStorage(accountHash, storageHash);
  }

  /**
   * Flatten everything into a single diff at the bottom
   */
  private flatten(): Snapshot {
    if (this.parent instanceof DiskLayer) {
      // we're the first in line, return ourself
      return this;
    }

    const parent = this.parent.flatten() as DiffLayer;

    // try to mark parent as stale
    if (parent.stale) {
      throw new Error('stale parent diff layer');
    }
    parent.stale = true;

    // merge all changes to parent
    for (const hash of this.destructSet) {
      parent.destructSet.add(hash);
      parent.accountData.delete(hash);
      parent.storageData.delete(hash);
    }
    for (const [hash, data] of this.accountData) {
      parent.accountData.set(hash, data);
    }
    for (const [hash, storage] of this.storageData) {
      let parentStorage = parent.storageData.get(hash);
      if (!parentStorage) {
        parentStorage = new FunctionalBufferMap<Buffer>();
        parent.storageData.set(hash, parentStorage);
      }
      for (const [storageHash, storageValue] of storage) {
        parentStorage.set(storageHash, storageValue);
      }
    }

    return new DiffLayer(parent.parent, this.root, parent.destructSet, parent.accountData, parent.storageData, this.diffed, parent.memory + this.memory);
  }

  /**
   * Get a list of all account hashes contained in this layer
   * @returns Account hash list
   */
  getAccountList() {
    if (this.accountList === undefined) {
      this.accountList = [];
      for (const [hash] of this.accountData) {
        this.accountList.push(hash);
      }
      for (const hash of this.destructSet) {
        if (!this.accountData.has(hash)) {
          this.accountList.push(hash);
        }
      }
      this.accountList.sort(Buffer.compare);
    }
    return this.accountList;
  }

  /**
   * Get a list of all storage hashes contained in this layer for target account
   * @param accountHash - Account hash
   * @returns Storage hash list
   */
  getStorageList(accountHash: Buffer) {
    const destructed = this.destructSet.has(accountHash);

    let list = this.storageList?.get(accountHash);
    if (list) {
      return { list, destructed };
    }

    list = [];
    const storage = this.storageData.get(accountHash);
    if (storage) {
      for (const [storageHash] of storage) {
        list.push(storageHash);
      }
      list.sort(Buffer.compare);
    }

    if (!this.storageList) {
      this.storageList = new FunctionalBufferMap<Buffer[]>();
    }
    this.storageList.set(accountHash, list);

    return { list, destructed };
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
   * Generates an iterator that traverses all accounts in this object
   * @param seek - Point to start traversing
   * @returns Iterator
   */
  genAccountIterator(seek: Buffer) {
    const accountList = this.getAccountList();
    const index = accountList.findIndex((value) => seek.compare(value) <= 0);
    return asyncTraverseHashList(
      index === -1 ? [] : accountList.slice(index),
      () => this.stale,
      (hash: Buffer) => {
        const serializedAccount = this.accountData.get(hash);
        if (!serializedAccount) {
          if (this.destructSet.has(hash)) {
            return null;
          }
          throw new Error('missing hash in account data');
        }
        return StakingAccount.fromRlpSerializedAccount(serializedAccount);
      }
    );
  }

  /**
   * Generates an iterator that traverses all storage data in this object for the target account
   * @param accountHash - Target account hash
   * @param seek - Point to start traversing
   * @returns Iterator
   */
  genStorageIterator(accountHash: Buffer, seek: Buffer) {
    const { list, destructed } = this.getStorageList(accountHash);
    const index = list.findIndex((value) => seek.compare(value) <= 0);
    return {
      iter: asyncTraverseHashList(
        index === -1 ? [] : list.slice(index),
        () => this.stale,
        (hash: Buffer) => {
          const storageValue = this.storageData.get(accountHash)?.get(hash);
          if (!storageValue) {
            throw new Error('missing hash in storage data');
          }
          return storageValue;
        }
      ),
      destructed
    };
  }

  /**
   * Persist self to disk
   * @param output - Output array
   * @returns Disk layer root hash
   */
  async journal(output: any[]) {
    const root = this.parent.journal(output);

    if (this.stale) {
      throw new Error('stale diff layer');
    }

    const destructSet: Buffer[] = [];
    for (const accountHash of this.destructSet) {
      destructSet.push(accountHash);
    }

    const accountData: [Buffer, Buffer][] = [];
    for (const [accountHash, _accountData] of this.accountData) {
      accountData.push([accountHash, _accountData]);
    }

    const storageData: [Buffer, Buffer[], Buffer[]][] = [];
    for (const [accountData, storage] of this.storageData) {
      const storageHashes: Buffer[] = [];
      const storageValues: Buffer[] = [];
      for (const [storageHash, storageValue] of storage) {
        storageHashes.push(storageHash);
        storageValues.push(storageValue);
      }
      storageData.push([accountData, storageHashes, storageValues]);
    }

    output.push([this.root, destructSet, accountData, storageData]);

    return root;
  }
}
