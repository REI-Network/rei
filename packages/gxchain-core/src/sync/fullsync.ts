import { OrderedQueue } from '@gxchain2/utils';
import { constants } from '@gxchain2/common';
import { Peer } from '@gxchain2/network';

import { Synchronizer, SynchronizerOptions } from './sync';

export interface FullSynchronizerOptions extends SynchronizerOptions {
  limit: number;
  count: number;
}

type Task = {
  start: number;
  count: number;
};

export class FullSynchronizer extends Synchronizer {
  private readonly queue: OrderedQueue<Task>;
  private readonly count: number;

  constructor(options: FullSynchronizerOptions) {
    super(options);
    this.count = options.count;
    this.queue = new OrderedQueue<Task>({
      limit: options.limit,
      processTask: this.download.bind(this)
    });
    this.queue.on('error', (queue, err) => this.emit('error', err));
  }

  private async download(task: Task) {
    const peer = this.peerpool.idle(constants.GXC2_ETHWIRE);
    if (!peer) {
      await new Promise((r) => setTimeout(r, 1000));
      throw new Error('can not find idle peer');
    }
    peer.idle = false;
    try {
      const result = await peer.request(constants.GXC2_ETHWIRE, 'GetBlockHeaders', [task.start, task.count]);
      peer.idle = true;
      return result;
    } catch (err) {
      peer.idle = true;
      // TODO: pretty this.
      if (err.message && err.message.indexOf('timeout') !== -1) {
        this.peerpool.ban(peer, 1);
      }
      throw err;
    }
  }

  async sync(): Promise<boolean> {
    await this.queue.reset();
    let latestHeight = this.blockchain.latestHeight;
    let bestHeight = latestHeight;
    let best: Peer | undefined;
    for (const peer of this.peerpool.peers) {
      const height = peer.latestHeight(constants.GXC2_ETHWIRE);
      if (height > bestHeight) {
        best = peer;
        bestHeight = height;
      }
    }
    if (!best) {
      return false;
    }

    let totalCount = bestHeight - latestHeight;
    let i = 0;
    while (totalCount > 0) {
      this.queue.insert({
        start: i * this.count,
        count: totalCount > this.count ? this.count : totalCount - this.count
      });
      totalCount -= this.count;
      i++;
    }
    await this.queue.start();
    return true;
  }

  async abort() {
    await this.queue.abort();
    await super.abort();
  }

  async reset() {
    await this.queue.reset();
    await super.reset();
  }
}
