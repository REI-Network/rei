import { BaseTrie as Trie } from '@rei-network/trie';
import { BN, KECCAK256_NULL, KECCAK256_RLP } from 'ethereumjs-util';
import { Database } from '@rei-network/database';
import {
  DBDeleteSnapAccount,
  DBDeleteSnapStorage,
  DBSaveSerializedSnapAccount,
  DBSaveSnapStorage
} from '@rei-network/database/dist/helpers';
import {
  snapStorageKey,
  snapAccountKey,
  SNAP_ACCOUNT_PREFIX,
  SNAP_STORAGE_PREFIX
} from '@rei-network/database/dist/constants';
import { FunctionalBufferSet, logger } from '@rei-network/utils';
import { StakingAccount } from '../stateManager';
import { EMPTY_HASH, MAX_HASH, DBatch } from '../utils';
import { KVIterator } from './trieIterator';
import { DiffLayer } from './diffLayer';
import { asyncTraverseRawDB } from './layerIterator';
import { journalProgress } from './journal';
import { ISnapshot, AccountData, StorageData, GeneratorStats } from './types';
import { increaseKey, mergeProof, wipeKeyRange, SimpleAborter } from './utils';

const accountCheckRange = 128;
const storageCheckRange = 1024;
const idealBatchSize = 102400;

/**
 * ProofResult keeps the proof result
 */
type ProofResult = {
  // all keys
  keys: Buffer[];
  // all values
  vals: Buffer[];
  // whether there are more snapshots on the disk
  diskMore: boolean;
  // whether there are more values in the trie
  trieMore: boolean;
  // is it verified
  proofed: boolean;
  trie?: Trie;
};

type OnState = (
  key: Buffer,
  val: Buffer | null,
  isWrite: boolean,
  isDelete: boolean
) => Promise<boolean>;

type GenerateAborter = SimpleAborter<GeneratorStats | void>;

export class DiskLayer implements ISnapshot {
  readonly db: Database;
  readonly root: Buffer;
  readonly parent = undefined;

  stale = false;
  genMarker?: Buffer;

  // An aborter to abort snapshot generation
  aborter?: GenerateAborter;

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
    return StakingAccount.fromRlpSerializedSlimAccount(
      await this.getSerializedAccount(accountHash)
    );
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
  update(
    root: Buffer,
    destructSet: FunctionalBufferSet,
    accountData: AccountData,
    storageData: StorageData
  ) {
    return DiffLayer.createDiffLayerFromParent(
      this,
      root,
      destructSet,
      accountData,
      storageData
    );
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
        {
          gte: snapStorageKey(accountHash, seek),
          lte: snapStorageKey(accountHash, MAX_HASH)
        },
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
  async journal(output: any[]) {
    const stats = await this.abort();

    if (this.stale) {
      throw new Error('stale disk layer');
    }

    const batch = new DBatch(this.db);
    journalProgress(batch, this.genMarker, stats as undefined | GeneratorStats);

    await batch.write();

    return this.root;
  }

  /**
   * proveRange will try to load existing snapshots based on prefix, origin, and verify their validity
   * @param root - Trie root
   * @param prefix - Key prefix
   * @param origin - Key origin
   * @param max - Maximum number of keys processed
   * @param convertValue - A function to convert the value
   *                       Sometimes, the value stored in the snapshot is not consistent with the trie,
   *                       in which case a conversion is required to pass the verification
   *
   * return: {@link ProofResult}
   */
  async proveRange(
    root: Buffer,
    prefix: Buffer,
    origin: Buffer,
    max: number,
    convertValue: (value: Buffer) => Buffer
  ): Promise<ProofResult> {
    const keys: Buffer[] = [];
    const vals: Buffer[] = [];
    let diskMore = false;
    let trieMore = false;

    const iter = asyncTraverseRawDB(
      this.db.rawdb,
      {
        gte: Buffer.concat([prefix, origin]),
        lte: Buffer.concat([prefix, MAX_HASH])
      },
      (key) => key.length !== prefix.length + origin.length,
      (key) => key.slice(prefix.length),
      convertValue
    );

    // traverse snapshots on disk
    for await (const { hash, getValue } of iter) {
      const value = getValue();

      if (keys.length === max) {
        // the maximum value is reached, stop traversing
        diskMore = true;
        break;
      }

      keys.push(hash);
      vals.push(value);
    }

    /**
     * We have obtained all the snapshots in the disk,
     * at this time we only need to compare whether it is consistent with the node
     */
    if (origin.equals(EMPTY_HASH) && !diskMore) {
      const trie = new Trie();
      for (let i = 0; i < keys.length; i++) {
        await trie.put(keys[i], vals[i]);
      }

      if (!trie.root.equals(root)) {
        return {
          keys,
          vals,
          diskMore,
          trieMore,
          proofed: false
        };
      }

      return {
        keys,
        vals,
        diskMore,
        trieMore,
        proofed: true
      };
    }

    // try to verify range proof
    const trie = new Trie(this.db.rawdb, root);
    const originProof = await Trie.createProof(trie, origin);
    const last = keys.length > 0 ? keys[keys.length - 1] : null;
    const lastProof = last && (await Trie.createProof(trie, last));
    const proof = lastProof ? mergeProof(originProof, lastProof) : originProof;

    let proofed = false;
    try {
      trieMore = await Trie.verifyRangeProof(
        root,
        origin,
        last,
        keys,
        vals,
        proof
      );
      proofed = true;
    } catch (err) {
      // ignore error...
    }

    return {
      keys,
      vals,
      diskMore,
      trieMore,
      proofed,
      trie
    };
  }

  /**
   * generateRange will first try to load the snapshot in the disk and verify it.
   * If the verification fails, it will traverse the trie and regenerate the snapshot
   * @param root - Trie root
   * @param prefix - Key prefix
   * @param origin - Key origin
   * @param max -  Maximum number of keys processed
   * @param onState - Callback that will be called when data is loaded
   * @param convertValue - A function to convert the value
   * @returns Whether there are still values that have not been generated, and the last key processed
   */
  async generateRange(
    root: Buffer,
    prefix: Buffer,
    origin: Buffer,
    max: number,
    onState: OnState,
    convertValue: (value: Buffer) => Buffer
  ) {
    const {
      keys,
      vals,
      diskMore,
      trieMore: _trieMore,
      proofed,
      trie: _trie
    } = await this.proveRange(root, prefix, origin, max, convertValue);
    const last = keys.length > 0 ? keys[keys.length - 1] : null;

    // if the snapshot in the current disk is valid, no need to traverse the trie
    if (proofed) {
      for (let i = 0; i < keys.length; i++) {
        if (await onState(keys[0], vals[0], false, false)) {
          return { exhausted: false, last: null };
        }
      }

      return { exhausted: !diskMore && !_trieMore, last };
    }

    let trieMore = false;
    let count = 0;
    let created = 0;
    let updated = 0;
    let deleted = 0;
    let untouched = 0;

    // start traversing the Trie
    const trie = _trie ?? new Trie(this.db.rawdb, root);
    for await (const { key, val } of new KVIterator(trie)) {
      if (last && key.compare(last) > 0) {
        trieMore = true;
        break;
      }

      count++;
      let write = true;
      created++;

      // try to compare with the value in the snapshot that already exists
      while (keys.length > 0) {
        const cmp = keys[0].compare(key);
        if (cmp < 0) {
          // delete useless snapshots
          await onState(keys[0], null, false, true);
          keys.splice(0, 1);
          vals.splice(0, 1);
          deleted++;
          continue;
        } else if (cmp === 0) {
          created--;
          write = !vals[0].equals(val);
          if (write) {
            // inconsistent snapshots need to be rewritten
            updated++;
          } else {
            // consistent and valid snapshots do not need to be rewritten
            untouched++;
          }
          keys.splice(0, 1);
          vals.splice(0, 1);
        }
        break;
      }

      // write the snapshot
      if (await onState(key, val, write, false)) {
        return { exhausted: false, last: null };
      }
    }

    // delete all remaining invalid old snapshots
    for (let i = 0; i < keys.length; i++) {
      if (await onState(keys[i], vals[i], false, true)) {
        return { exhausted: false, last: null };
      }
      deleted++;
    }

    return { exhausted: !trieMore && !diskMore, last };
  }

  /**
   * Generate snapshot
   */
  private async _generate(aborter: GenerateAborter, stats: GeneratorStats) {
    logger.info('📷 Generating snapshot...');

    let accMarker: Buffer | null = null;
    let accountRange = accountCheckRange;

    if (this.genMarker) {
      accMarker = this.genMarker.slice(0, 32);
      accountRange = 1;
    }

    const batch = new DBatch(this.db);

    // persistent journal
    const checkAndFlush = async (currentLocation: Buffer) => {
      if (batch.length > idealBatchSize || aborter.isAborted) {
        if (this.genMarker && currentLocation.compare(this.genMarker) < 0) {
          // TODO: log error
        }

        journalProgress(batch, currentLocation, stats);

        await batch.write();

        this.genMarker = currentLocation;
      }

      return aborter.isAborted;
    };

    // delete all slots for account
    const deleteAllSlotsForAccount = (accountHash: Buffer) => {
      return wipeKeyRange(
        batch,
        EMPTY_HASH,
        MAX_HASH,
        (origin, limit) =>
          asyncTraverseRawDB(
            this.db.rawdb,
            {
              gte: snapStorageKey(accountHash, origin),
              lte: snapStorageKey(accountHash, limit)
            },
            (key) => key.length !== SNAP_STORAGE_PREFIX.length + 32 + 32,
            (key) => key.slice(SNAP_STORAGE_PREFIX.length + 32),
            (value) => value
          ),
        (hash: Buffer) => DBDeleteSnapStorage(accountHash, hash)
      );
    };

    // procces an account
    const onAccount: OnState = async (key, val, isWrite, isDelete) => {
      const accountHash = key;

      // delete the account
      if (isDelete) {
        batch.push(DBDeleteSnapAccount(accountHash));
        await deleteAllSlotsForAccount(accountHash);
        return aborter.isAborted;
      }

      const account = StakingAccount.fromRlpSerializedAccount(val!);

      if (accMarker === null || !accountHash.equals(accMarker)) {
        let dataLen = val!.length;
        if (!isWrite) {
          // account already exists, no need to rewrite
          if (account.codeHash.equals(KECCAK256_NULL)) {
            dataLen -= 32;
          }
          if (account.stateRoot.equals(KECCAK256_RLP)) {
            dataLen -= 32;
          }
        } else {
          // write the account
          const data = account.slimSerialize();
          dataLen = data.length;
          batch.push(DBSaveSerializedSnapAccount(accountHash, data));
        }
        // SNAP_ACCOUNT_PREFIX(1) + accountHash(32) + dataLen
        stats.storage.iaddn(1 + 32 + dataLen);
        stats.accounts.iaddn(1);
      }

      /**
       * This is a special case, `this.genMarker` is accoutHash + storageHash,
       * if the last generation is a slot of this account,
       * then we need to ensure that the newly written marker is not smaller than the original marker
       */
      let marker = accountHash;
      if (
        accMarker !== null &&
        marker.equals(accMarker) &&
        this.genMarker &&
        this.genMarker.length > 32
      ) {
        marker = this.genMarker;
      }

      if (await checkAndFlush(marker)) {
        return true;
      }

      if (account.stateRoot.equals(KECCAK256_RLP)) {
        // account's trie is empty, delete all slots
        await deleteAllSlotsForAccount(accountHash);
      } else {
        // account's trie is not empty, try to write all slots
        let storeMarker: Buffer | null = null;
        if (
          accMarker !== null &&
          accountHash.equals(accMarker) &&
          this.genMarker &&
          this.genMarker.length > 32
        ) {
          storeMarker = this.genMarker.slice(32);
        }

        const onStorage: OnState = async (key, val, isWrite, isDelete) => {
          if (isDelete) {
            // delete this slot
            batch.push(DBDeleteSnapStorage(accountHash, key));
            return aborter.isAborted;
          }
          if (isWrite) {
            // write this slot
            batch.push(DBSaveSnapStorage(accountHash, key, val!));
          }
          // SNAP_STORAGE_PREFIX(1) + accountHash(32) + storageHash(32) + val.length
          stats.storage.iaddn(1 + 32 + 32 + val!.length);
          stats.slots.iaddn(1);

          return await checkAndFlush(Buffer.concat([accountHash, key]));
        };

        let storeOrigin = storeMarker ?? EMPTY_HASH;
        while (true) {
          const { exhausted, last } = await this.generateRange(
            account.stateRoot,
            Buffer.concat([SNAP_STORAGE_PREFIX, accountHash]),
            storeOrigin,
            storageCheckRange,
            onStorage,
            (value) => value
          );
          if (aborter.isAborted) {
            return true;
          }

          if (exhausted || last === null) {
            break;
          }

          // process next slots
          const nextStoreOrigin = increaseKey(last);
          if (nextStoreOrigin === null) {
            break;
          }

          storeOrigin = nextStoreOrigin;
        }
      }

      // some account processed, unmark the marker
      accMarker = null;

      return aborter.isAborted;
    };

    let accOrigin = accMarker ?? EMPTY_HASH;
    while (true) {
      const { exhausted, last } = await this.generateRange(
        this.root,
        SNAP_ACCOUNT_PREFIX,
        accOrigin,
        accountRange,
        onAccount,
        (value) => value
      );
      if (aborter.isAborted) {
        await batch.write();

        aborter.abortFinished(stats);

        return;
      }

      if (exhausted || last === null) {
        break;
      }

      // process next accounts
      const nextAccOrigin = increaseKey(last);
      if (nextAccOrigin === null) {
        break;
      }

      accOrigin = nextAccOrigin;
      accountRange = accountCheckRange;

      logger.info(
        `📷 Generating snapshot, progress: ${new BN(nextAccOrigin)
          .muln(100)
          .div(new BN(MAX_HASH))
          .toNumber()}%`
      );
    }

    journalProgress(batch, undefined, stats);

    await batch.write();

    this.genMarker = undefined;

    if (aborter.isAborted) {
      aborter.abortFinished();
    }

    logger.info(`📷 Generating snapshot, progress: ${100}%`);
  }

  /**
   * Generate snapshot
   */
  async generate(stats: GeneratorStats) {
    if (this.aborter) {
      throw new Error('generating');
    }

    try {
      this.aborter = new SimpleAborter<GeneratorStats | void>();
      await this._generate(this.aborter, stats);
    } finally {
      if (this.aborter?.isAborted) {
        this.aborter.abortFinished();
      }
      this.aborter = undefined;
    }
  }

  /**
   * Abort generating
   */
  abort() {
    return this.aborter?.abort() ?? Promise.resolve();
  }
}
