import type { FunctionalBufferMap, FunctionalBufferSet } from '@rei-network/utils';
import type { StakingAccount } from '../stateManager';
import type { DiffLayer } from './diffLayer';
import type { DiskLayer } from './diskLayer';

export interface ISnapshot {
  readonly root: Buffer;

  parent?: Snapshot;

  stale: boolean;

  getAccount(hash: Buffer): Promise<StakingAccount | null>;

  getSerializedAccount(hash: Buffer): Promise<Buffer | null>;

  getStorage(accountHash: Buffer, storageHash: Buffer): Promise<Buffer | null>;

  genAccountIterator(seek: Buffer): SnapIterator<StakingAccount | null>;

  genStorageIterator(accountHash: Buffer, seek: Buffer): { iter: SnapIterator<Buffer>; destructed: boolean };

  journal(output: any[]): Buffer;
}

export type Snapshot = DiffLayer | DiskLayer;

export type DestructSet = FunctionalBufferSet;

export type AccountData = FunctionalBufferMap<Buffer>;

export type StorageData = FunctionalBufferMap<FunctionalBufferMap<Buffer>>;

export type SnapIteratorReturnType<T> = { hash: Buffer; getValue: () => T };

export type SnapIterator<T> = AsyncGenerator<SnapIteratorReturnType<T>, SnapIteratorReturnType<T> | void>;
