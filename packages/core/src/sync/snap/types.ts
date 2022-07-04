import type { StakingAccount } from '../../stateManager';

export type AccountRequest = {
  origin: Buffer;
  limit: Buffer;
};

export type AccountResponse = {
  hashes: Buffer[];
  accounts: StakingAccount[];

  cont: boolean;
};

export type StorageRequst = {
  accounts: Buffer[];
  roots: Buffer[];

  origin: Buffer;
  limit: Buffer;
};

export type StorageResponse = {
  hashes: Buffer[][];
  slots: Buffer[][];

  cont: boolean;
};

export interface SnapSyncPeer {
  getAccountRange(root: Buffer, req: AccountRequest): Promise<AccountResponse | null>;
  getStorageRanges(root: Buffer, req: StorageRequst): Promise<StorageResponse | null>;
  getByteCodes(hashes: Buffer[]): Promise<(Buffer | undefined)[] | null>;
  getTrieNodes(hashes: Buffer[]): Promise<(Buffer | undefined)[] | null>;
}

export type PeerType = 'account' | 'storage' | 'code' | 'trieNode';

export interface SnapSyncNetworkManager {
  getIdlePeer(type: PeerType): SnapSyncPeer | null;
  putBackIdlePeer(type: PeerType, peer: SnapSyncPeer);
}
