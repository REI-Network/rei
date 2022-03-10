import { BaseTrie as Trie } from 'merkle-patricia-tree';
import { keccak256 } from 'ethereumjs-util';
import { Database } from '@rei-network/database';
import { snapStorageKey, snapAccountKey, SNAP_ACCOUNT_PREFIX, SNAP_STORAGE_PREFIX } from '@rei-network/database/dist/constants';
import { FunctionalBufferSet } from '@rei-network/utils';
import { StakingAccount } from '../stateManager';
import { EMPTY_HASH, MAX_HASH } from '../utils';
import { verifyRangeProof } from './verifyRangeProof';
import { TrieIterator } from './trieIterator';
import { DiffLayer } from './diffLayer';
import { asyncTraverseRawDB } from './iterator';
import { ISnapshot, AccountData, StorageData } from './types';

function mergeProof(proof1: Buffer[], proof2: Buffer[]) {
  const proof: Buffer[] = [];
  const set = new FunctionalBufferSet();
  for (const p of proof1) {
    proof.push(p);
    set.add(keccak256(p));
  }
  for (const p of proof2) {
    if (!set.has(keccak256(p))) {
      proof.push(p);
    }
  }
  return proof;
}

type ProofResult = {
  keys: Buffer[];
  vals: Buffer[];
  diskMore: boolean;
  trieMore: boolean;
  proofed: boolean;
  trie?: Trie;
};

type OnState = (key: Buffer, val: Buffer | null, isWrite: boolean, isDelete: boolean) => Promise<void>;

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

  async proveRange(root: Buffer, prefix: Buffer, origin: Buffer, max: number, convertValue: (value: Buffer) => Buffer): Promise<ProofResult> {
    const keys: Buffer[] = [];
    const vals: Buffer[] = [];
    let diskMore = false;
    let trieMore = false;

    const iter = asyncTraverseRawDB(
      this.db.rawdb,
      { gte: Buffer.concat([prefix, origin]), lte: Buffer.concat([prefix, MAX_HASH]) },
      (key) => key.length !== prefix.length + origin.length,
      (key) => key.slice(prefix.length + origin.length),
      convertValue
    );

    for await (const { hash, getValue } of iter) {
      const value = getValue();

      if (keys.length === max) {
        diskMore = true;
        break;
      }

      keys.push(hash);
      vals.push(value);
    }

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

    const trie = new Trie(this.db.rawdb, root);
    const originProof = await Trie.createProof(trie, origin);
    const last = keys.length > 0 ? keys[keys.length - 1] : null;
    const lastProof = last && (await Trie.createProof(trie, last));
    const proof = lastProof ? mergeProof(originProof, lastProof) : originProof;

    let proofed = false;
    try {
      trieMore = await verifyRangeProof(root, origin, last, keys, vals, proof);
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

  async generateRange(root: Buffer, prefix: Buffer, origin: Buffer, max: number, onState: OnState, convertValue: (value: Buffer) => Buffer) {
    const { keys, vals, diskMore, trieMore: _trieMore, proofed, trie: _trie } = await this.proveRange(root, prefix, origin, max, convertValue);
    const last = keys.length > 0 ? keys[keys.length - 1] : null;

    if (proofed) {
      for (let i = 0; i < keys.length; i++) {
        await onState(keys[0], vals[0], false, false);
      }

      return { exhausted: !diskMore && !_trieMore, last };
    }

    let trieMore = false;
    let count = 0;
    let created = 0;
    let updated = 0;
    let deleted = 0;
    let untouched = 0;

    const trie = _trie ?? new Trie(this.db.rawdb, root);
    for await (const { key, val } of new TrieIterator(trie)) {
      if (last && key.compare(last) > 0) {
        trieMore = true;
        break;
      }

      count++;
      let write = true;
      created++;

      while (keys.length > 0) {
        const cmp = keys[0].compare(key);
        if (cmp < 0) {
          await onState(keys[0], null, false, true);
          keys.splice(0, 1);
          vals.splice(0, 1);
          deleted++;
          continue;
        } else if (cmp === 0) {
          created--;
          write = !vals[0].equals(val);
          if (write) {
            updated++;
          } else {
            untouched++;
          }
          keys.splice(0, 1);
          vals.splice(0, 1);
        }
        break;
      }

      await onState(key, val, write, false);
    }

    for (let i = 0; i < keys.length; i++) {
      await onState(keys[i], vals[i], false, true);
      deleted++;
    }

    return {
      exhausted: !trieMore && !diskMore,
      last
    };
  }
}
