import { FunctionalBufferMap, FunctionalBufferSet } from '@rei-network/utils';
import { Account } from 'ethereumjs-util';

export interface ISnapshot {
  root(): Buffer;

  account(hash: Buffer): Account;

  accountRLP(hash: Buffer): Buffer;

  // storage(accountHash: Buffer, storageHash: Buffer): Buffer;
}

export interface Snapshot extends ISnapshot {
  parent(): Snapshot;

  update(blockRoot: Buffer, destructs: Map<Buffer, Buffer>, accounts: Map<Buffer, Buffer>, storage: Map<Buffer, Buffer>): Promise<Snapshot>;
}

export interface SnapshotTree {
  snapshot(blockRoot: Buffer): ISnapshot;

  update(root: Buffer, parent: Buffer, accounts: FunctionalBufferMap<Buffer>, destructs: FunctionalBufferSet, storage: FunctionalBufferMap<FunctionalBufferMap<Buffer>>): Promise<void>;

  cap(root: Buffer, layers: number): Promise<void>;
}
