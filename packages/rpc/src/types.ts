import type { BNLike } from 'ethereumjs-util';
import type { Block, Transaction } from '@rei-network/structure';
import type { Common } from '@rei-network/Common';
import type VM from '@gxchain2-ethereumjs/vm';
import type { StateManager } from '@gxchain2-ethereumjs/vm/dist/state';

export type SyncingStatus = { syncing: true; status: { startingBlock: string; currentBlock: string; highestBlock: string } } | false;

export const JSONRPC_VERSION = '2.0';

export interface Backend {
  readonly chainId: number;

  readonly db: any; // TODO: fix types
  readonly sync: any; // TODO: fix types
  readonly accMngr: any; // TODO: fix types
  readonly txPool: any; // TODO: fix types
  readonly networkMngr: any; // TODO: fix types
  readonly bcMonitor: any; // TODO: fix types

  getLatestBlock(): Block;
  getPendingBlock(): Block;
  getPendingStateManager(): Promise<StateManager>;
  getStateManager(root: Buffer, num: BNLike | Common): Promise<StateManager>;
  getVM(root: Buffer, num: BNLike | Common): Promise<VM>;
  getCommon(num: BNLike): Common;
  getLatestCommon(): Common;
  getCurrentEngine(): any; // TODO: fix types
  getFilter(): any; // TODO: fix types
  getTracer(): any; // TODO: fix types

  addPendingTxs(txs: Transaction[]): Promise<boolean[]>;
}
