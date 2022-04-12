import { rlp, BN } from 'ethereumjs-util';
import { Database } from '@rei-network/database';
import { FunctionalBufferMap, FunctionalBufferSet, logger } from '@rei-network/utils';
import { snapStorageKey, SNAP_STORAGE_PREFIX } from '@rei-network/database/dist/constants';
import { DBDeleteSnapRoot, DBDeleteSnapAccount, DBDeleteSnapStorage, DBSaveSerializedSnapAccount, DBSaveSnapStorage, DBSaveSnapRoot, DBDeleteSnapJournal, DBDeleteSnapGenerator, DBSaveSnapDisabled, DBDeleteSnapRecoveryNumber, DBDeleteSnapDisabled, DBSaveSnapJournal } from '@rei-network/database/dist/helpers';
import { DBatch } from './batch';
import { DiffLayer } from './diffLayer';
import { DiskLayer } from './diskLayer';
import { GeneratorStats, Snapshot } from './types';
import { SimpleAborter, wipeKeyRange } from './utils';
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
  onFlatten?: Function;

  constructor(diskdb: Database, cache: number, root: Buffer, layers: FunctionalBufferMap<Snapshot>, onFlatten?: Function) {
    this.diskdb = diskdb;
    this.cache = cache;
    this.layers = layers;
    this.onFlatten = onFlatten;
  }

  static async createSnapTree(diskdb: Database, cache: number, root: Buffer, async: boolean, rebuild: boolean, recovery: boolean, onFlatten?: Function) {
    const layers = new FunctionalBufferMap<Snapshot>();
    const snaptree = new SnapTree(diskdb, cache, root, layers, onFlatten);
    try {
      let head: undefined | Snapshot = await loadSnapshot(diskdb, root, recovery);
      //TODO check disable
      while (head !== undefined) {
        let layer = snaptree.layers.get(head.root);
        layer = head;
        head = head.parent;
      }
      if (async) {
        await snaptree.waitBuild();
      }
      return snaptree;
    } catch (error) {
      if (rebuild) {
        logger.warn('Failed to load snapshot, regenerating', 'err', error);
        await snaptree.rebuild(root);
        return snaptree;
      }
      throw error;
    }
  }

  async waitBuild() {
    // TODO
  }

  async disable() {
    for (const [root, layer] of this.layers) {
      if (layer instanceof DiskLayer) {
        if ((layer as DiskLayer).aborter !== undefined) {
          await layer.abort();
        }
        layer.stale = true;
      } else if (layer instanceof DiffLayer) {
        layer.stale = true; // problem atomic.StoreUint32(&layer.stale, 1)
      }
    }

    this.layers = new FunctionalBufferMap<Snapshot>();

    const batch = new DBatch(this.diskdb);

    batch.push(DBSaveSnapDisabled());
    batch.push(DBDeleteSnapRoot());
    batch.push(DBDeleteSnapJournal());
    batch.push(DBDeleteSnapGenerator());
    batch.push(DBDeleteSnapRecoveryNumber());

    await batch.write();
  }

  snapShot(root: Buffer) {
    return this.layers.get(root);
  }

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
      if (!(layer instanceof DiskLayer) && nodisk) {
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

  update(root: Buffer, parentRoot: Buffer, destructs: FunctionalBufferSet, accounts: FunctionalBufferMap<Buffer>, storage: FunctionalBufferMap<FunctionalBufferMap<Buffer>>) {
    if (root.equals(parentRoot)) {
      throw new Error('snapshot cycle');
    }
    const parent = this.snapShot(parentRoot);
    if (!parent) {
      throw new Error(`parent ${parentRoot} snapshot missing`);
    }
    const snap = (parent as Snapshot).update(root, destructs, accounts, storage);
    this.layers.set(snap.root, snap);
  }

  async cap(root: Buffer, layers: number) {
    const snap = this.snapShot(root);
    if (!snap) {
      throw new Error(`snapshot ${root} missing`);
    }
    if (!(snap instanceof DiffLayer)) {
      throw new Error(`snapshot ${root} is disk layer`);
    }

    if (snap.origin.genMarker !== undefined && layers > 8) {
      layers = 8;
    }
    const diff = snap as DiffLayer;
    if (layers === 0) {
      const base = await diffToDisk(diff.flatten() as DiffLayer);
      this.layers = new FunctionalBufferMap<Snapshot>();
      this.layers.set(base.root, base);
      return;
    }
    const persisted = await this._cap(diff, layers);
    const children = new FunctionalBufferMap<Buffer[]>();
    for (const [root, snap] of this.layers) {
      if (snap instanceof DiffLayer) {
        const parent = snap.parent.root;
        const parentRoot = children.get(parent);
        if (parentRoot) {
          children.set(parent, parentRoot.concat([root]));
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

  async _cap(diff: DiffLayer, layers: number) {
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
    } else if (parent instanceof DiskLayer) {
      const flattened = (parent as DiffLayer).flatten() as DiffLayer;
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

    const bottom = diff.parent as DiffLayer;
    const base = await diffToDisk(bottom);
    this.layers.set(base.root, base);
    diff.parent = base;
    return base;
  }

  async rebuild(root: Buffer) {
    const batch = new DBatch(this.diskdb);
    batch.push(DBDeleteSnapRecoveryNumber());
    batch.push(DBDeleteSnapDisabled());
    await batch.write();
    for (const [root, layer] of this.layers) {
      if (layer instanceof DiskLayer) {
        if ((layer as DiskLayer).aborter !== undefined) {
          await layer.abort();
        }
        layer.stale = true;
      } else if (layer instanceof DiffLayer) {
        layer.stale = true; // problem atomic.StoreUint32(&layer.stale, 1)
      }
    }

    logger.Info('Rebuilding state snapshot');
    const layers = new FunctionalBufferMap<Snapshot>();
    layers.set(root, await generateSnapshot(this.diskdb, root));
    this.layers = layers;
  }

  async journal(root: Buffer) {
    const snap = this.snapShot(root);
    if (snap === undefined) {
      throw new Error(`snapshot ${root} missing`);
    }
    let journal = rlp.encode(journalVersion);

    const diskroot = this.diskroot();
    if (diskroot === Buffer.from([])) {
      throw new Error('invalid disk root');
    }
    Buffer.concat([journal, rlp.encode(diskroot)]);

    const base = snap.journal([journal]);
    const batch = new DBatch(this.diskdb);
    batch.push(DBSaveSnapJournal(journal));
    await batch.write();

    return base;
  }

  diskroot() {
    const disklayer = this.diskLayer();
    if (disklayer === undefined) {
      return Buffer.from([]);
    }
    return disklayer.root;
  }

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
      return snap as DiskLayer;
    } else if (snap instanceof DiffLayer) {
      return snap.origin;
    }
  }

  generating() {
    const layer = this.diskLayer();
    if (layer === undefined) {
      throw new Error('disk layer is missing');
    }
    return layer.genMarker !== undefined;
  }

  accountIterator(root: Buffer, seek: Buffer) {
    const ok = this.generating();
    if (ok) {
      throw new Error('snapshot is not constructed');
    }
    const snap = this.snapShot(root);
    return snap?.genAccountIterator(seek);
  }

  storageIterator(root: Buffer, account: Buffer, seek: Buffer) {
    const ok = this.generating();
    if (ok) {
      throw new Error('snapshot is not constructed');
    }
    const snap = this.snapShot(root);
    return snap?.genStorageIterator(account, seek);
  }

  verify(root: Buffer) {
    const accountIt = this.accountIterator(root, Buffer.from([]));
    //TODO const got = generateTrieRoot()
  }
}

async function diffToDisk(bottom: DiffLayer): Promise<DiskLayer> {
  const base = bottom.parent as DiskLayer;
  const batch = new DBatch(base.db);
  const stats = await base.abort();

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
  journalProgress(batch, base.genMarker!, stats as undefined | GeneratorStats);

  await batch.write();
  const res = new DiskLayer(base.db, bottom.root);
  if (base.genMarker !== undefined) {
    res.genMarker = base.genMarker;
    await res.generate(stats!);
  }
  return res;
}

async function generateSnapshot(db: Database, root: Buffer) {
  const stats: GeneratorStats = { origin: EMPTY_HASH, start: Date.now(), accounts: new BN(0), slots: new BN(0), storage: new BN(0) };
  const batch = new DBatch(db);
  const genMarker = Buffer.from([]);

  batch.push(DBSaveSnapRoot(root));
  journalProgress(batch, genMarker, stats);
  await batch.write();

  const base = new DiskLayer(db, root);
  base.genMarker = genMarker;
  base.generate(stats);
  logger.debug('Start snapshot generation, root:', root);
  return base;
}
