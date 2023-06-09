import { rlp, bufferToInt, toBuffer, BN, bufferToHex } from 'ethereumjs-util';
import { Database, DBSaveSnapGenerator } from '@rei-network/database';
import { FunctionalBufferMap, FunctionalBufferSet, logger } from '@rei-network/utils';
import { EMPTY_HASH, DBatch } from '../utils';
import { DiskLayer } from './diskLayer';
import { Snapshot, GeneratorStats } from './types';
import { DiffLayer } from './diffLayer';

const journalVersion = 0;

/**
 * SnapJournalGenerator records the generation journal of the snapshot
 */
export class SnapJournalGenerator {
  readonly done: boolean;
  readonly marker: Buffer;
  readonly accounts: BN;
  readonly slots: BN;
  readonly storage: BN;

  /**
   * Construct journal from serialized journal
   * @param serializedJournal
   * @returns Journal
   */
  static fromSerializedJournal(serializedJournal: Buffer) {
    const values = rlp.decode(serializedJournal) as unknown as Buffer[];

    if (!Array.isArray(values)) {
      throw new Error('invalid serialized journal');
    }

    return SnapJournalGenerator.fromValuesArray(values);
  }

  /**
   * Construct journal from values array
   * @param values
   * @returns Journal
   */
  static fromValuesArray(values: Buffer[]) {
    if (values.length !== 5) {
      throw new Error('invalid values');
    }

    const done = bufferToInt(values[0]);
    const marker = values[1];
    const accounts = new BN(values[2]);
    const slots = new BN(values[3]);
    const storage = new BN(values[4]);

    return new SnapJournalGenerator(done === 1, marker, accounts, slots, storage);
  }

  constructor(done: boolean, marker: Buffer, accounts: BN, slots: BN, storage: BN) {
    this.done = done;
    this.marker = marker;
    this.accounts = accounts;
    this.slots = slots;
    this.storage = storage;
  }

  /**
   * Convert journal to values array
   * @returns Values array
   */
  raw() {
    return [toBuffer(this.done ? 1 : 0), this.marker, toBuffer(this.accounts), toBuffer(this.slots), toBuffer(this.storage)];
  }

  /**
   * Convert journal to serialized journal
   * @returns Serialized journal
   */
  serialize() {
    return rlp.encode(this.raw());
  }
}

type DestructSetJournal = Buffer[];
type AccountDataJournal = [Buffer, Buffer][];
type StorageDataJournal = [Buffer, Buffer[], Buffer[]][];
type DiffLayerJournal = [Buffer, DestructSetJournal, AccountDataJournal, StorageDataJournal];
type Journal = (Buffer | DiffLayerJournal)[];

function isDestructSetJournal(journal: any): journal is DestructSetJournal {
  if (!Array.isArray(journal)) {
    return false;
  }

  for (const ele of journal) {
    if (!(ele instanceof Buffer)) {
      return false;
    }
  }

  return true;
}

function isAccountDataJournal(journal: any): journal is AccountDataJournal {
  if (!Array.isArray(journal)) {
    return false;
  }

  for (const ele of journal) {
    if (!Array.isArray(ele)) {
      return false;
    }

    if (ele.length !== 2) {
      return false;
    }

    if (!(ele[0] instanceof Buffer) || !(ele[1] instanceof Buffer)) {
      return false;
    }
  }

  return true;
}

function isStorageDataJournal(journal: any): journal is StorageDataJournal {
  if (!Array.isArray(journal)) {
    return false;
  }

  for (const ele of journal) {
    if (!Array.isArray(ele)) {
      return false;
    }

    if (ele.length !== 3) {
      return false;
    }

    if (!(ele[0] instanceof Buffer)) {
      return false;
    }

    if (!Array.isArray(ele[1]) || !Array.isArray(ele[2])) {
      return false;
    }

    if (ele[1].length !== ele[2].length) {
      return false;
    }

    for (const _ele of ele[1]) {
      if (!(_ele instanceof Buffer)) {
        return false;
      }
    }

    for (const _ele of ele[2]) {
      if (!(_ele instanceof Buffer)) {
        return false;
      }
    }
  }

  return true;
}

export function isDiffLayerJournal(journal: any): journal is DiffLayerJournal {
  if (!Array.isArray(journal)) {
    return false;
  }

  if (journal.length !== 4) {
    return false;
  }

  if (!(journal[0] instanceof Buffer) || !isDestructSetJournal(journal[1]) || !isAccountDataJournal(journal[2]) || !isStorageDataJournal(journal[3])) {
    return false;
  }

  return true;
}

/**
 * Load diff layer from journal
 * @param parent - Parent layer
 * @param journalArray
 * @param offset - Offset of current layer
 * @returns Bottom layer
 */
function loadDiffLayer(parent: Snapshot, journalArray: any[], offset: number): Snapshot {
  if (offset > journalArray.length - 1) {
    return parent;
  }

  const journal = journalArray[offset];
  if (!isDiffLayerJournal(journal)) {
    throw new Error('invalid diff layer journal');
  }

  const root = journal[0];

  const destructSet = new FunctionalBufferSet();
  for (const accountHash of journal[1]) {
    destructSet.add(accountHash);
  }

  const accountData = new FunctionalBufferMap<Buffer>();
  for (const [accountHash, _accountData] of journal[2]) {
    accountData.set(accountHash, _accountData);
  }

  const storageData = new FunctionalBufferMap<FunctionalBufferMap<Buffer>>();
  for (const [accountHash, storageHashes, storageValues] of journal[3]) {
    const storage = new FunctionalBufferMap<Buffer>();
    storageHashes.forEach((hash, i) => storage.set(hash, storageValues[i]));
    storageData.set(accountHash, storage);
  }

  return loadDiffLayer(DiffLayer.createDiffLayerFromParent(parent, root, destructSet, accountData, storageData), journalArray, offset + 1);
}

/**
 * Load and parse journal
 * @param db
 * @param base
 * @returns Journal generator and bottom layer
 */
async function loadAndParseJournal(
  db: Database,
  base: DiskLayer
): Promise<{
  generator: SnapJournalGenerator;
  snapshot: Snapshot;
}> {
  const serializedGenerator = await db.getSnapGenerator();
  if (serializedGenerator === null) {
    throw new Error('load generator failed');
  }

  const generator = SnapJournalGenerator.fromSerializedJournal(serializedGenerator);

  const serializedJournal = await db.getSnapJournal();
  if (serializedJournal === null) {
    // the journal doesn't exist, ignore
    return { generator, snapshot: base };
  }

  const journal = rlp.decode(serializedJournal) as unknown as Journal;
  if (journal.length < 2) {
    // invalid journal version, throw error
    throw new Error('invalid journal');
  }

  const _journalVersion = journal[0];
  const diskRoot = journal[1];
  if (!(_journalVersion instanceof Buffer) || !(diskRoot instanceof Buffer)) {
    // invalid journal version, throw error
    throw new Error('invalid journal');
  }

  if (bufferToInt(_journalVersion) !== journalVersion) {
    // unsupported journal version, ignore
    return { generator, snapshot: base };
  }

  if (!diskRoot.equals(base.root)) {
    // unmatched root, ignore
    return { generator, snapshot: base };
  }

  return { generator, snapshot: loadDiffLayer(base, journal, 3) };
}

/**
 * Load snapshot from database
 * @param db - Database
 * @param root - Root hash
 * @param recovery - Recovery snapshot
 * @returns Snapshot
 */
export async function loadSnapshot(db: Database, root: Buffer, recovery: boolean) {
  // TODO: check disable

  const baseRoot = await db.getSnapRoot();
  if (baseRoot === null) {
    throw new Error('missing snapshot root');
  }

  const base = new DiskLayer(db, baseRoot);
  const { snapshot, generator } = await loadAndParseJournal(db, base);

  if (!snapshot.root.equals(root)) {
    if (!recovery) {
      throw new Error('unmatched root');
    }
    logger.warn('Snapshot is not continuous with chain, snap:', bufferToHex(snapshot.root), 'blockchain:', bufferToHex(root));
  }

  // TODO: Do not continue to generate snapshots!
  // if (!generator.done) {
  //   base.genMarker = generator.marker;
  //   base.generate({
  //     origin: generator.marker,
  //     start: Date.now(),
  //     accounts: generator.accounts,
  //     slots: generator.slots,
  //     storage: generator.storage
  //   });
  // }

  return snapshot;
}

/**
 * Persistent snapshot generation progress to disk
 * @param batch
 * @param marker
 * @param stats
 */
export function journalProgress(batch: DBatch, marker?: Buffer, stats?: GeneratorStats) {
  const done = marker === undefined;
  marker = marker ?? EMPTY_HASH;
  const accounts = stats?.accounts.clone() ?? new BN(0);
  const slots = stats?.slots.clone() ?? new BN(0);
  const storage = stats?.storage.clone() ?? new BN(0);
  const generator = new SnapJournalGenerator(done, marker, accounts, slots, storage);
  batch.push(DBSaveSnapGenerator(generator.serialize()));
}
