import { FunctionalBufferMap } from '@rei-network/utils';
import { Account } from 'ethereumjs-util';
import { DB } from 'merkle-patricia-tree/dist/db';
import Semaphore from 'semaphore-async-await';

export interface ISnapshot {
  root(): Buffer;

  account(hash: Buffer): Account;

  accountRLP(hash: Buffer): Buffer;

  storage(accountHash: Buffer, storageHash: Buffer): Buffer;
}

export interface Snapshot extends ISnapshot {
  parent(): Snapshot;

  update(blockRoot: Buffer, destructs: Map<Buffer, Buffer>, accounts: Map<Buffer, Buffer>, storage: Map<Buffer, Buffer>): Snapshot;
}

export interface SnapshotTree {
  diskdb: DB;

  triedb: DB;

  cache: number;

  layers: Map<Buffer, Snapshot>;

  lock: Semaphore;

  snapshot(blockRoot: Buffer): ISnapshot;

  update(root: Buffer, parent: Buffer, accounts: FunctionalBufferMap<Buffer>, destructs: FunctionalBufferMap<Buffer>, storage: FunctionalBufferMap<FunctionalBufferMap<Buffer>>): void;

  cap(root: Buffer, layers: number): void;
}

interface ToSnapAccount {
  (account: Account): Buffer;
}
