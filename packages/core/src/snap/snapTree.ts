import { rlp, BN, intToBuffer } from 'ethereumjs-util';
import { Database } from '@rei-network/database';
import { FunctionalBufferMap, FunctionalBufferSet, logger } from '@rei-network/utils';
import { snapStorageKey, SNAP_STORAGE_PREFIX } from '@rei-network/database/dist/constants';
import { DBDeleteSnapRoot, DBDeleteSnapAccount, DBDeleteSnapStorage, DBSaveSerializedSnapAccount, DBSaveSnapStorage, DBSaveSnapRoot, DBDeleteSnapJournal, DBDeleteSnapGenerator, DBSaveSnapDisabled, DBDeleteSnapRecoveryNumber, DBDeleteSnapDisabled, DBSaveSnapJournal } from '@rei-network/database/dist/helpers';
import { DBatch } from './batch';
import { DiffLayer } from './diffLayer';
import { DiskLayer } from './diskLayer';
import { GeneratorStats, Snapshot } from './types';
import { wipeKeyRange } from './utils';
import { asyncTraverseRawDB } from './layerIterator';
import { journalProgress, loadSnapshot } from './journal';
import { EMPTY_HASH, MAX_HASH } from '../utils';

const aggregatorMemoryLimit = 4 * 1024 * 1024;
const idealBatchSize = 102400;
const journalVersion = 0;

export class SnapTree {
  diskdb: Database;
  cache: number;
  layers: FunctionalBufferMap<Snapshot>;
  onFlatten?: Function; // Hook invoked when the bottom most diff layers are flattened

  constructor(diskdb: Database, cache: number, root: Buffer, layers: FunctionalBufferMap<Snapshot>, onFlatten?: Function) {
    this.diskdb = diskdb;
    this.cache = cache;
    this.layers = layers;
    this.onFlatten = onFlatten;
  }

  /**
   * New attempts to load an already existing snapshot from a persistent key-value
   * If the snapshot is missing or the disk layer is broken, the snapshot will be
   * reconstructed using both the existing data and the state trie.
   *
   * If the memory layers in the journal do not match the disk layer
   * or the journal is missing, there are two repair cases:
   * - if the 'recovery' parameter is true, all memory diff-layers will be discarded.
   * - otherwise, the entire snapshot is considered invalid and will be recreated
   * @param diskdb - Persistent database to store the snapshot
   * @param cache - Megabytes permitted to use for read caches
   * @param root - Root hash
   * @param async - Rebuild snaptree async or not
   * @param rebuild - Rebuild or not
   * @param recovery - Recovery snapshot
   * @param onFlatten - Hook invoked when the bottom most diff layers are flattened
   * @returns
   */
  static async createSnapTree(diskdb: Database, cache: number, root: Buffer, async: boolean, rebuild: boolean, recovery: boolean, onFlatten?: Function) {
    const layers = new FunctionalBufferMap<Snapshot>();
    const snaptree = new SnapTree(diskdb, cache, root, layers, onFlatten);
    try {
      let head: Snapshot | undefined = await loadSnapshot(diskdb, root, recovery);
      //TODO check disable
      while (head !== undefined) {
        snaptree.layers.set(head.root, head);
        head = head.parent;
      }
      return snaptree;
    } catch (error) {
      if (rebuild) {
        logger.warn('Failed to load snapshot, regenerating', 'err', error);
        const generating = (await snaptree.rebuild(root)).generating;
        if (!async) {
          await generating;
        }
        return snaptree;
      }
    }
  }

  /**
   * Interrupts any pending snapshot generator,deletes all the snapshot
   * in memory marks snapshots disabled globally
   */
  async disable() {
    for (const [, layer] of this.layers) {
      if (layer instanceof DiskLayer) {
        if (layer.aborter !== undefined) {
          await layer.abort();
        }
      }
      layer.stale = true;
    }

    this.layers.clear();

    const batch = new DBatch(this.diskdb);

    batch.push(DBSaveSnapDisabled());
    batch.push(DBDeleteSnapRoot());
    batch.push(DBDeleteSnapJournal());
    batch.push(DBDeleteSnapGenerator());
    batch.push(DBDeleteSnapRecoveryNumber());

    await batch.write();
    batch.reset();
  }

  /**
   * Retrieves a snapshot belonging to the given root
   * @param root - Target layer root
   * @returns - Snapshot
   */
  snapShot(root: Buffer) {
    return this.layers.get(root);
  }

  /**
   * Snapshots returns all visited layers from the topmost layer with specific
   * root and traverses downward
   * @param root - Topmost layer hash
   * @param limit - Limit layers number
   * @param nodisk - Disk layer excluded or not
   * @returns Layers
   */
  snapShots(root: Buffer, limit: number, nodisk: boolean) {
    if (limit === 0) {
      return;
    }
    let layer = this.layers.get(root);
    if (!layer) {
      return;
    }
    const ret: Snapshot[] = [];

    for (limit; limit > 0; limit--) {
      if (layer instanceof DiskLayer && nodisk) {
        break;
      }
      ret.push(layer!);
      const parent = layer!.parent;
      if (!parent) {
        break;
      }
      layer = parent;
    }
    return ret;
  }

  /**
   * Update adds a new snapshot into the tree, if that can be linked to an existing
   * old parent
   * @param root - Root hash
   * @param parentRoot - Parent root hash
   * @param accounts - Accounts data
   * @param destructs - Destruct accounts data
   * @param storage - Accounts storage data
   */
  update(root: Buffer, parentRoot: Buffer, accounts: FunctionalBufferMap<Buffer>, destructs: FunctionalBufferSet, storage: FunctionalBufferMap<FunctionalBufferMap<Buffer>>) {
    if (root.equals(parentRoot)) {
      throw new Error('snapshot cycle');
    }
    // Generate a new snapshot on top of the parent
    const parent = this.layers.get(parentRoot);
    if (!parent) {
      throw new Error(`parent ${parentRoot} snapshot missing`);
    }
    const snap = parent.update(root, destructs, accounts, storage);
    this.layers.set(snap.root, snap);
  }

  /**
   * Cap traverses downwards the snapshot tree from a head block hash until the
   * number of allowed layers are crossed. All layers beyond the permitted number
   * are flattened downwards.
   * @param root - From layer's root hash
   * @param layers - Number of layers to save
   */
  async cap(root: Buffer, layers: number) {
    // Retrieve the head snapshot to cap from
    const snap = this.layers.get(root);
    if (!snap) {
      throw new Error(`snapshot ${root} missing`);
    }
    if (!(snap instanceof DiffLayer)) {
      throw new Error(`snapshot ${root} is disk layer`);
    }
    // If the generator is still running, use a more aggressive cap
    if (snap.origin.genMarker !== undefined && layers > 8) {
      layers = 8;
    }
    const diff = snap;
    // Flattening the bottom-most diff layer requires special casing since there's
    // no child to rewire to the grandparent. In that case we can fake a temporary
    // child for the capping and then remove it.
    if (layers === 0) {
      const base = await diffToDisk(diff.flatten() as DiffLayer);
      this.layers.clear();
      // Replace the entire snapshot tree with the flat base
      this.layers.set(base.root, base);
      return;
    }
    const persisted = await this._cap(diff, layers);

    // Remove any layer that is stale or links into a stale layer
    const children = new FunctionalBufferMap<Buffer[]>();
    for (const [root, snap] of this.layers) {
      if (snap instanceof DiffLayer) {
        const parent = snap.parent.root;
        const parentRoot = children.get(parent);
        if (parentRoot) {
          parentRoot.push(root);
        } else {
          children.set(parent, [root]);
        }
      }
    }
    const remove = (root: Buffer) => {
      this.layers.delete(root);
      const datas = children.get(root);
      if (datas) {
        for (const data of datas) {
          remove(data);
        }
      }
      children.delete(root);
    };

    for (const [root, snap] of this.layers) {
      if (snap.stale) {
        remove(root);
      }
    }

    // If the disk layer was modified, regenerate all the cumulative blooms
    if (persisted) {
      const rebloom = (root: Buffer) => {
        const diff = this.layers.get(root);
        if (diff instanceof DiffLayer) {
          diff.rebloom();
          //TODO rebloom(persisted)
        }
        const childs = children.get(root);
        if (childs) {
          for (const child of childs) {
            rebloom(child);
          }
        }
      };
      rebloom(persisted.root);
    }
    return;
  }

  /**
   * cap traverses downwards the diff tree until the number of allowed layers are
   * crossed. All diffs beyond the permitted number are flattened downwards. If the
   * layer limit is reached, memory cap is also enforced (but not before).
   *
   * The method returns the new disk layer if diffs were persisted into it.
   * @param diff - Difflayer
   * @param layers - Number of layers crossed
   * @returns New disk layer
   */
  async _cap(diff: DiffLayer, layers: number) {
    // Dive until we run out of layers or reach the persistent database
    for (let i = 0; i < layers - 1; i++) {
      if (diff.parent instanceof DiffLayer) {
        diff = diff.parent;
      } else {
        return;
      }
    }

    const parent = diff.parent;
    if (parent instanceof DiskLayer) {
      return;
    } else {
      // Flatten the parent into the grandparent. The flattening internally obtains a
      // write lock on grandparent.
      const flattened = parent.flatten() as DiffLayer;
      this.layers.set(flattened.root, flattened);
      if (this.onFlatten) {
        this.onFlatten();
      }
      diff.parent = flattened;
      if (flattened.memory < aggregatorMemoryLimit) {
        if (!(flattened.parent as DiskLayer).genMarker) {
          return;
        }
      }
    }
    // If the bottom-most layer is larger than our memory cap, persist to disk
    const bottom = diff.parent as DiffLayer;
    const base = await diffToDisk(bottom);
    this.layers.set(base.root, base);
    diff.parent = base;
    return base;
  }

  /**
   * Rebuild wipes all available snapshot data from the persistent database and
   * discard all caches and diff layers. Afterwards, it starts a new snapshot
   * generator with the given root hash.
   * @param root - hash root
   * @returns Generating Promise
   */
  async rebuild(root: Buffer) {
    const batch = new DBatch(this.diskdb);
    batch.push(DBDeleteSnapRecoveryNumber());
    batch.push(DBDeleteSnapDisabled());
    await batch.write();
    batch.reset();

    // Iterate over and mark all layers stale
    for (const [root, layer] of this.layers) {
      if (layer instanceof DiskLayer) {
        if (layer.aborter !== undefined) {
          await layer.abort();
        }
      }
      layer.stale = true;
    }

    this.layers.clear();
    const { base, generating } = await generateSnapshot(this.diskdb, root);
    this.layers.set(root, base);
    return { generating };
  }

  /**
   * Journal commits an entire diff hierarchy to disk into a single journal entry.
   * This is meant to be used during shutdown to persist the snapshot without
   * flattening everything down (bad for reorgs).
   * @param root - Root hash
   * @returns - Disk layer root hash
   */
  async journal(root: Buffer) {
    // Retrieve the head snapshot to journal from var snap snapshot
    const snap = this.layers.get(root);
    if (snap === undefined) {
      throw new Error(`snapshot ${root} missing`);
    }

    const diskroot = this.diskroot();
    if (diskroot === undefined) {
      throw new Error('invalid disk root');
    }
    const versionBuf = intToBuffer(journalVersion);
    const journal: Buffer[] = [versionBuf, Buffer.from(diskroot)];
    const base = snap.journal(journal);
    const batch = new DBatch(this.diskdb);
    // Store the journal into the database and return
    batch.push(DBSaveSnapJournal(rlp.encode(journal)));
    await batch.write();
    batch.reset();
    return base;
  }

  /**
   * diskroot return the root of disklayer.
   * @returns - Root hash
   */
  diskroot() {
    const disklayer = this.diskLayer();
    if (disklayer === undefined) {
      return undefined;
    }
    return disklayer.root;
  }

  /**
   * disklayer return the disk layer
   * @returns - Disklayer
   */
  diskLayer() {
    let snap: Snapshot | undefined = undefined;
    for (const [root, s] of this.layers) {
      snap = s;
      break;
    }
    if (snap === undefined) {
      return undefined;
    }
    if (snap instanceof DiskLayer) {
      return snap;
    } else {
      return snap.origin;
    }
  }

  /**
   * generating is an internal helper function which reports whether the snapshot
   * is still under the construction.
   * @returns Generating or not
   */
  generating() {
    const layer = this.diskLayer();
    if (layer === undefined) {
      throw new Error('disk layer is missing');
    }
    return layer.genMarker !== undefined;
  }

  /**
   * AccountIterator creates a new account iterator for the specified root hash and
   * seeks to a starting account hash.
   * @param root - Root hash
   * @param seek - Point to start traversing
   * @returns - Iterator
   */
  accountIterator(root: Buffer, seek: Buffer) {
    const ok = this.generating();
    if (ok) {
      throw new Error('snapshot is not constructed');
    }
    const snap = this.layers.get(root);
    if (snap === undefined) {
      throw new Error(`unknown snapshot,root: ${root}`);
    }
    return snap.genAccountIterator(seek);
  }

  /**
   * StorageIterator creates a new storage iterator for the specified root hash and
   * account. The iterator will be move to the specific start position.
   * @param root - Root hash
   * @param account - Target account hash
   * @param seek - Point to start traversing
   * @returns - Iterator
   */
  storageIterator(root: Buffer, account: Buffer, seek: Buffer) {
    const ok = this.generating();
    if (ok) {
      throw new Error('snapshot is not constructed');
    }
    const snap = this.layers.get(root);
    if (snap === undefined) {
      throw new Error(`unknown snapshot,root: ${root}`);
    }
    return snap.genStorageIterator(account, seek);
  }

  verify(root: Buffer) {
    const accountIt = this.accountIterator(root, Buffer.alloc(0));
    //TODO const got = generateTrieRoot()
  }
}

/**
 * diffToDisk merges a bottom-most diff into the persistent disk layer underneath
 * it. The method will panic if called onto a non-bottom-most diff layer.
 * @param bottom - Difflayer to change
 * @returns - Disklayer
 */
async function diffToDisk(bottom: DiffLayer): Promise<DiskLayer> {
  const base = bottom.parent;
  if (!(base instanceof DiskLayer)) {
    throw new Error('parent layer is not a disklayer');
  }
  const batch = new DBatch(base.db);
  const stats = await base.abort();

  // Put the deletion in the batch writer, flush all updates in the final step.
  batch.push(DBDeleteSnapRoot());

  if (base.stale) {
    throw new Error('parent disk layer is stale');
  }
  base.stale = true;

  // Destroy all the destructed accounts from the database
  for (const accountHash of bottom.destructSet) {
    if (base.genMarker !== undefined && accountHash.compare(base.genMarker) > 0) {
      continue;
    }
    batch.push(DBDeleteSnapAccount(accountHash));

    await wipeKeyRange(
      base.db,
      EMPTY_HASH,
      MAX_HASH,
      (origin, limit) =>
        asyncTraverseRawDB(
          base.db.rawdb,
          { gte: snapStorageKey(accountHash, origin), lte: snapStorageKey(accountHash, limit) },
          (key) => key.length !== SNAP_STORAGE_PREFIX.length + 32 + 32,
          (key) => key.slice(SNAP_STORAGE_PREFIX.length + 32),
          (value) => value
        ),
      (hash: Buffer) => DBDeleteSnapStorage(accountHash, hash)
    );
  }

  // Push all updated accounts into the database
  for (const [accountHash, data] of bottom.accountData) {
    if (base.genMarker !== undefined && accountHash.compare(base.genMarker) > 0) {
      continue;
    }
    batch.push(DBSaveSerializedSnapAccount(accountHash, data));

    if (batch.length > idealBatchSize) {
      await batch.write();
      batch.reset();
    }
  }

  // Push all the storage slots into the database
  for (const [accountHash, storage] of bottom.storageData) {
    if (base.genMarker !== undefined && accountHash.compare(base.genMarker) > 0) {
      continue;
    }

    const midAccount = base.genMarker !== undefined && accountHash.equals(base.genMarker.slice(0, 32));
    for (const [storageHash, data] of storage) {
      if (midAccount && storageHash.compare(base.genMarker!.slice(32)) > 0) {
        continue;
      }
      if (data.length > 0) {
        batch.push(DBSaveSnapStorage(accountHash, storageHash, data));
      } else {
        batch.push(DBDeleteSnapStorage(accountHash, storageHash));
      }
    }
  }
  batch.push(DBSaveSnapRoot(bottom.root));

  // Write out the generator progress marker and report
  journalProgress(batch, base.genMarker, stats as undefined | GeneratorStats);

  await batch.write();
  batch.reset();
  const res = new DiskLayer(base.db, bottom.root);
  if (base.genMarker !== undefined) {
    res.genMarker = base.genMarker;
    await res.generate(stats!);
  }
  return res;
}

/**
 * generateSnapshot regenerates a brand new snapshot based on an existing state
 * database and head block asynchronously. The snapshot is returned immediately
 * and generation is continued in the background until done.
 * @param db - Database
 * @param root - Root hash
 * @returns - Disklayer and it's generate state
 */
async function generateSnapshot(db: Database, root: Buffer) {
  // Create a new disk layer with an initialized state marker at zero
  const stats: GeneratorStats = { origin: EMPTY_HASH, start: Date.now(), accounts: new BN(0), slots: new BN(0), storage: new BN(0) };
  const batch = new DBatch(db);
  const genMarker = undefined;

  batch.push(DBSaveSnapRoot(root));
  journalProgress(batch, genMarker, stats);
  await batch.write();
  batch.reset();
  const base = new DiskLayer(db, root);
  base.genMarker = genMarker;
  const generating = base.generate(stats);
  logger.debug('Start snapshot generation, root:', root);
  return { base, generating };
}
