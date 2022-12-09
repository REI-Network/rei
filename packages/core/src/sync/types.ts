import type { BN } from 'ethereumjs-util';
import type { Block, Receipt } from '@rei-network/structure';

export type SyncInfo = {
  bestHeight: BN;
  bestTD: BN;
  remotePeerId: string;
};

export type BlockData = {
  block: Block;
  receipts: Receipt[];
};
