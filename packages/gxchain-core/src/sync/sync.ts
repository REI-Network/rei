import { EventEmitter } from 'events';

import { Aborter } from '@gxchain2/utils';
import { Peer } from '@gxchain2/network';

import type { Node } from '../node';

export interface SynchronizerOptions {
  node: Node;
  interval?: number;
}

export declare interface Synchronizer {
  on(event: 'synchronized', lisener: () => void): this;
  on(event: 'error', lisener: (err: any) => void): this;

  once(event: 'synchronized', lisener: () => void): this;
  once(event: 'error', lisener: (err: any) => void): this;
}

export class Synchronizer extends EventEmitter {
  protected readonly node: Node;
  protected readonly interval: number;
  protected aborter = new Aborter();
  protected running: boolean = false;
  protected forceSync: boolean = false;

  constructor(options: SynchronizerOptions) {
    super();
    this.node = options.node;
    this.interval = options.interval || 1000;
  }

  get isSyncing(): boolean {
    throw new Error('Unimplemented');
  }

  protected async _sync(target?: { peer: Peer; height: number }): Promise<boolean> {
    throw new Error('Unimplemented');
  }

  async sync(target?: { peer: Peer; height: number }) {
    try {
      if (!this.isSyncing && (await this._sync(target))) {
        console.debug('synchronized');
        this.emit('synchronized');
      }
    } catch (err) {
      this.emit('error', err);
    }
  }

  async syncAbort() {
    throw new Error('Unimplemented');
  }

  async announce(peer: Peer, height: number) {
    throw new Error('Unimplemented');
  }

  async start() {
    if (this.running) {
      throw new Error('Synchronizer already started!');
    }
    this.running = true;
    const timeout = setTimeout(() => {
      this.forceSync = true;
    }, this.interval * 30);
    while (!this.aborter.isAborted) {
      await this.sync();
      await this.aborter.abortablePromise(new Promise((r) => setTimeout(r, this.interval)));
    }
    this.running = false;
    clearTimeout(timeout);
  }

  async abort() {
    await this.aborter.abort(new Error('Synchronizer abort'));
  }

  async reset() {
    this.aborter.reset();
  }
}
