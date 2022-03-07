import type { FunctionalBufferMap } from '@rei-network/utils';
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
}

export type Snapshot = DiffLayer | DiskLayer;

export type AccountData = FunctionalBufferMap<Buffer>;

export type StorageData = FunctionalBufferMap<FunctionalBufferMap<Buffer>>;
