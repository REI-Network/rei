import { EventEmitter } from 'events';

import { Aborter } from '@gxchain2/utils';

import type { Node } from '../node';

export interface SynchronizerOptions {
  node: Node;
  interval?: number;
}

export declare interface Synchronizer {
  on(event: 'synchronized', lisener: () => void);
  on(event: 'error', lisener: (err: any) => void);

  once(event: 'synchronized', lisener: () => void);
  once(event: 'error', lisener: (err: any) => void);
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

  async sync(): Promise<boolean> {
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
      try {
        if (await this.sync()) {
          this.emit('synchronized');
        }
      } catch (err) {
        this.emit('error', err);
      }
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
