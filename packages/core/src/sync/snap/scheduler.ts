import EventEmitter from 'events';
import { SyncInfo } from '../types';
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
  readonly syncer: SnapSync;

  private aborted: boolean = false;
  private onFinished?: () => Promise<void>;
  private syncPromise?: Promise<void>;
  private syncResolve?: () => void;

  // sync state
  private startingBlock: number = 0;
  private highestBlock: number = 0;

  constructor(syncer: SnapSync) {
    super();
    this.syncer = syncer;
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

  /**
   * Reset snap sync root and highest block number
   * @param height - Highest block number
   * @param root - New state root
   * @param onFinished - On finished callback
   */
  async resetRoot(height: number, root: Buffer, onFinished?: () => Promise<void>) {
    if (!this.aborted && this.syncer.root !== undefined && !this.syncer.root.equals(root)) {
      this.highestBlock = height;
      this.onFinished = onFinished;
      // abort and restart sync
      await this.syncer.abort();
      await this.syncer.snapSync(root);
    }
  }

  /**
   * Async start snap sync,
   * this function will not wait until snap sync finished
   * @param root - State root
   * @param startingBlock - Start sync block number
   * @param info - Sync info
   * @param onFinished - On finished callback,
   *                     it will be invoked when sync finished
   */
  async snapSync(root: Buffer, startingBlock: number, info: SyncInfo, onFinished?: () => Promise<void>) {
    if (this.isSyncing) {
      throw new Error('SnapSyncScheduler is working');
    }

    this.onFinished = onFinished;
    this.startingBlock = startingBlock;
    this.highestBlock = info.bestHeight.toNumber();
    // send events
    this.emit('start', info);

    // start snap sync
    await this.syncer.snapSync(root);
    // wait until finished
    this.syncPromise = new Promise<void>((resolve) => {
      this.syncResolve = resolve;
      this.syncer.onFinished = () => {
        resolve();
      };
    }).finally(async () => {
      this.syncPromise = undefined;
      this.syncResolve = undefined;
      if (!this.aborted) {
        // invoke callback if it exists
        this.onFinished && (await this.onFinished());
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
    this.aborted = true;
    this.syncResolve && this.syncResolve();
    await this.syncer.abort();
  }
}
