import { rlp, bufferToInt, toBuffer } from 'ethereumjs-util';
import { Database } from '@rei-network/database';
import { FunctionalBufferMap, FunctionalBufferSet } from '@rei-network/utils';
import { DiskLayer } from './diskLayer';
import { Snapshot } from './types';
import { DiffLayer } from './diffLayer';

const globalJournalVersion = 0;

export class SnapJournalGenerator {
  done: boolean;
  marker: Buffer;
  accounts: number;
  slots: number;
  storage: number;

  static fromSerializedJournal(serializedJournal: Buffer) {
    const values = rlp.decode(serializedJournal) as unknown as Buffer[];

    if (!Array.isArray(values)) {
      throw new Error('invalid serialized journal');
    }

    return SnapJournalGenerator.fromValuesArray(values);
  }

  static fromValuesArray(values: Buffer[]) {
    if (values.length !== 5) {
      throw new Error('invalid values');
    }

    const done = bufferToInt(values[0]);
    const marker = values[1];
    const accounts = bufferToInt(values[2]);
    const slots = bufferToInt(values[3]);
    const storage = bufferToInt(values[4]);

    return new SnapJournalGenerator(done === 1, marker, accounts, slots, storage);
  }

  constructor(done: boolean, marker: Buffer, accounts: number, slots: number, storage: number) {
    this.done = done;
    this.marker = marker;
    this.accounts = accounts;
    this.slots = slots;
    this.storage = storage;
  }

  raw() {
    return [toBuffer(this.done ? 1 : 0), this.marker, toBuffer(this.accounts), toBuffer(this.slots), toBuffer(this.storage)];
  }

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

function isDiffLayerJournal(journal: any): journal is DiffLayerJournal {
  if (!Array.isArray(journal)) {
    return false;
  }

  if (journal.length !== 4) {
    return false;
  }

  if (!(journal[0] instanceof Buffer) || !isDestructSetJournal(journal[0]) || !isAccountDataJournal(journal[1]) || !isStorageDataJournal(journal[3])) {
    return false;
  }

  return true;
}

function loadDiffLayer(parent: Snapshot, journalArray: any[], offset: number): Snapshot | null {
  if (offset > journalArray.length - 1) {
    return parent;
  }

  const journal = journalArray[offset];
  if (!isDiffLayerJournal(journal)) {
    return null;
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

export async function loadSnapshot(db: Database) {
  const dbRoot = await db.getSnapRoot();
  if (dbRoot === null) {
    return null;
  }

  const journalGenerator = await db.getSnapGenerator();
  if (journalGenerator === null) {
    return null;
  }

  const generator = SnapJournalGenerator.fromSerializedJournal(journalGenerator);

  const serializedJournal = await db.getSnapJournal();
  if (serializedJournal === null) {
    return null;
  }

  const journal = rlp.decode(serializedJournal) as unknown as Journal;
  if (journal.length < 2) {
    return null;
  }

  const bufJournalVersion = journal[0];
  const diskRoot = journal[1];
  if (!(bufJournalVersion instanceof Buffer) || !(diskRoot instanceof Buffer)) {
    return null;
  }

  const journalVersion = bufferToInt(bufJournalVersion);
  if (journalVersion !== globalJournalVersion) {
    return null;
  }

  if (!diskRoot.equals(dbRoot)) {
    return null;
  }

  const diskLayer = new DiskLayer(db, dbRoot);
  const snapshot = loadDiffLayer(diskLayer, journal, 3);
  if (snapshot === null) {
    return null;
  }

  return { diskLayer, snapshot, generator };
}
