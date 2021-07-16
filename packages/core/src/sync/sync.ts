import { EventEmitter } from 'events';
import Semaphore from 'semaphore-async-await';
import { logger } from '@gxchain2/utils';
import { Peer } from '@gxchain2/network';
import type { Node } from '../node';

export interface SynchronizerOptions {
  node: Node;
  interval?: number;
}

export declare interface Synchronizer {
  on(event: 'start', listener: () => void): this;
  on(event: 'synchronized', listener: () => void): this;
  on(event: 'failed', listener: () => void): this;

  once(event: 'start', listener: () => void): this;
  once(event: 'synchronized', listener: () => void): this;
  once(event: 'failed', listener: () => void): this;
}

export abstract class Synchronizer extends EventEmitter {
  protected readonly node: Node;
  protected readonly interval: number;
  private lock = new Semaphore(1);
  protected forceSync: boolean = false;
  protected startingBlock: number = 0;
  protected highestBlock: number = 0;

  constructor(options: SynchronizerOptions) {
    super();
    this.node = options.node;
    this.interval = options.interval || 1000;
    this.syncLoop();
    setTimeout(() => {
      this.forceSync = true;
    }, this.interval * 30);
  }

  /**
   * Get the state of syncing
   */
  get status() {
    return { startingBlock: this.startingBlock, highestBlock: this.highestBlock };
  }

  /**
   *
   */
  get isSyncing(): boolean {
    return this.lock.getPermits() === 0;
  }

  announce(peer: Peer) {
    throw new Error('Unimplemented');
  }

  protected startSyncHook(startingBlock: number, highestBlock: number) {
    this.startingBlock = startingBlock;
    this.highestBlock = highestBlock;
    this.emit('start');
  }

  protected async _sync(peer?: Peer): Promise<boolean> {
    throw new Error('Unimplemented');
  }

  /**
   * Sync the blocks
   * @param target - the sync peer and height of block
   */
  async sync(peer?: Peer) {
    await this.lock.acquire();
    const before = this.node.blockchain.latestBlock.hash();
    const result = await this._sync(peer);
    const after = this.node.blockchain.latestBlock.hash();
    this.lock.release();

    if (!before.equals(after)) {
      if (result) {
        logger.info('💫 Synchronized');
        this.emit('synchronized');
      } else {
        this.emit('failed');
      }
      this.node.broadcastNewBlock(this.node.blockchain.latestBlock);
    }
  }

  /**
   * Start the Synchronizer
   */
  async syncLoop() {
    await this.node.blockchain.init();
    while (!this.node.aborter.isAborted) {
      if (!this.isSyncing) {
        await this.sync();
      }
      await this.node.aborter.abortablePromise(new Promise((r) => setTimeout(r, this.interval)));
    }
  }

  async abort() {
    throw new Error('Unimplemented');
  }
}
