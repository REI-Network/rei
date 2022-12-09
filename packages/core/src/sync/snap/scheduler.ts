import EventEmitter from 'events';
import { logger } from '@rei-network/utils';
import { Node } from '../../node';
import { SyncInfo, BlockData } from '../types';
import { SnapSync } from './snapSync';

export declare interface SnapSyncScheduler {
  on(event: 'start', listener: (info: SyncInfo) => void): this;
  on(event: 'finished', listener: (info: SyncInfo) => void): this;
  on(event: 'synchronized', listener: (info: SyncInfo) => void): this;
  on(event: 'failed', listener: (info: SyncInfo) => void): this;

  off(event: 'start', listener: (info: SyncInfo) => void): this;
  off(event: 'finished', listener: (info: SyncInfo) => void): this;
  off(event: 'synchronized', listener: (info: SyncInfo) => void): this;
  off(event: 'failed', listener: (info: SyncInfo) => void): this;
}

export class SnapSyncScheduler extends EventEmitter {
  readonly node: Node;
  readonly syncer: SnapSync;

  private syncPromise?: Promise<void>;

  // sync state
  private startingBlock: number = 0;
  private highestBlock: number = 0;

  constructor(node: Node) {
    super();
    this.node = node;
    this.syncer = new SnapSync(this.node.db, this.node.snap.pool);
  }

  /**
   * Get the sync state
   */
  get status() {
    return { startingBlock: this.startingBlock, highestBlock: this.highestBlock };
  }

  /**
   * Is it syncing
   */
  get isSyncing() {
    return !!this.syncPromise;
  }

  // Generate snapshot and save block data
  private async saveBlockData(root: Buffer, data: BlockData) {
    try {
      // rebuild local snap
      const { generating } = await this.node.snapTree.rebuild(root);
      // wait until generated
      await generating;
      // save block and receipts to database
      await this.node.commitBlock({
        ...data,
        broadcast: false,
        force: true,
        // total difficulty equals height
        td: data.block.header.number.addn(1)
      });
    } catch (err) {
      logger.error('SnapSyncScheduler::saveBlockData, commit failed:', err);
    }
  }

  /**
   * Reset snap sync root and highest block number
   * @param root - New state root
   * @param startingBlock - Start sync block number
   * @param info - Sync info
   * @param data - Sync block data
   */
  async resetRoot(root: Buffer, startingBlock: number, info: SyncInfo, data: BlockData) {
    if (this.syncer.root !== undefined && !this.syncer.root.equals(root)) {
      // abort
      await this.abort();
      // reset sync info
      this.startingBlock = startingBlock;
      this.highestBlock = info.bestHeight.toNumber();
      // start snap sync
      await this.syncer.snapSync(root);
      this.syncPromise = this.syncer.wait().finally(async () => {
        this.syncPromise = undefined;
        if (this.syncer.finished) {
          // save block data
          await this.saveBlockData(root, data);
          // send events
          this.emit('finished', info);
          this.emit('synchronized', info);
        }
      });
    }
  }

  /**
   * Async start snap sync,
   * this function will not wait until snap sync finished
   * @param root - State root
   * @param startingBlock - Start sync block number
   * @param info - Sync info
   * @param data - Sync block data
   */
  async snapSync(root: Buffer, startingBlock: number, info: SyncInfo, data: BlockData) {
    if (this.isSyncing) {
      throw new Error('SnapSyncScheduler is working');
    }
    // save sync info
    this.startingBlock = startingBlock;
    this.highestBlock = info.bestHeight.toNumber();
    // send events
    this.emit('start', info);
    // start snap sync
    await this.syncer.snapSync(root);
    // wait until finished
    this.syncPromise = this.syncer.wait().finally(async () => {
      this.syncPromise = undefined;
      if (this.syncer.finished) {
        // save block data
        await this.saveBlockData(root, data);
        // send events
        this.emit('finished', info);
        this.emit('synchronized', info);
      }
    });
  }

  /**
   * Abort sync
   */
  async abort() {
    await this.syncer.abort();
    if (this.syncPromise) {
      await this.syncPromise;
    }
  }
}
