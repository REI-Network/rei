import { BN } from 'ethereumjs-util';

export type SyncInfo = {
  bestHeight: BN;
  bestTD: BN;
  remotePeerId: string;
};

export type PreInfo = {
  preRoot: Buffer;
};
