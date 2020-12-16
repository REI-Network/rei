import { EventEmitter } from 'events';

import { PeerPool } from '@gxchain2/network';
import { Blockchain } from '@gxchain2/blockchain';
import { Aborter } from '@gxchain2/utils';

export interface SynchronizerOptions {
  peerpool: PeerPool;
  blockchain: Blockchain;
  interval: number;
}

export declare interface Synchronizer {
  on(event: 'synchronized', lisener: () => void);
  on(event: 'error', lisener: (err: any) => void);

  once(event: 'synchronized', lisener: () => void);
  once(event: 'error', lisener: (err: any) => void);
}

export class Synchronizer extends EventEmitter {
  protected readonly peerpool: PeerPool;
  protected readonly blockchain: Blockchain;
  protected aborter = new Aborter();
  protected running: boolean = false;
  protected forceSync: boolean = false;
  private readonly interval: number;

  constructor(options: SynchronizerOptions) {
    super();
    this.peerpool = options.peerpool;
    this.blockchain = options.blockchain;
    this.interval = options.interval;
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
    this.aborter.abort(new Error('Synchronizer abort'));
  }

  async reset() {
    this.aborter.reset();
  }
}
