import { OrderedQueue, AsyncNextArray } from '@gxchain2/utils';
import { constants } from '@gxchain2/common';
import { Peer } from '@gxchain2/network';
import { Block } from '@gxchain2/block';

import { Synchronizer, SynchronizerOptions } from './sync';

export interface FullSynchronizerOptions extends SynchronizerOptions {
  limit?: number;
  count?: number;
  timeoutBanTime?: number;
  errorBanTime?: number;
}

type Task = {
  start: number;
  count: number;
};

export class FullSynchronizer extends Synchronizer {
  private readonly downloadQueue: OrderedQueue<Task>;
  private readonly resultQueue = new AsyncNextArray<Block[] | null>();
  private readonly count: number;
  private readonly timeoutBanTime: number;
  private readonly errorBanTime: number;
  private abortFlag: boolean = false;

  constructor(options: FullSynchronizerOptions) {
    super(options);
    this.count = options.count || 128;
    this.timeoutBanTime = options.timeoutBanTime || 300000;
    this.errorBanTime = options.errorBanTime || 60000;
    this.downloadQueue = new OrderedQueue<Task, Block[]>({
      limit: options.limit || 16,
      processTask: this.download.bind(this)
    });
    this.downloadQueue.on('error', (queue, err) => this.emit('error', err));
    this.downloadQueue.on('result', (_, __, result: any) => {
      this.resultQueue.push(result);
    });
    this.processResult();
  }

  private async download(task: Task) {
    const peer = this.node.peerpool.idle(constants.GXC2_ETHWIRE);
    if (!peer) {
      await new Promise((r) => setTimeout(r, this.interval));
      throw new Error('can not find idle peer');
    }
    peer.idle = false;
    try {
      const headers: any[] = await peer.request(constants.GXC2_ETHWIRE, 'GetBlockHeaders', [task.start, task.count]);
      const bodies: any[] = await peer.request(
        constants.GXC2_ETHWIRE,
        'GetBlockBodies',
        headers.map((h: any) => h.hash())
      );
      const blocks = bodies.map(([txsData, unclesData], i: number) => Block.fromValuesArray([headers[i].raw(), txsData, unclesData], { common: this.node.common }));
      peer.idle = true;
      return blocks;
    } catch (err) {
      peer.idle = true;
      // TODO: pretty this.
      if (err.message && err.message.indexOf('timeout') !== -1) {
        this.node.peerpool.ban(peer, this.timeoutBanTime);
      } else {
        this.node.peerpool.ban(peer, this.errorBanTime);
      }
      throw err;
    }
  }

  private async *makeAsyncGenerator() {
    while (!this.abortFlag) {
      const result = await this.resultQueue.next();
      if (result === null) {
        return;
      }
      yield result;
    }
  }

  private async processResult() {
    for await (const result of this.makeAsyncGenerator()) {
      await this.node.processBlocks(result);
    }
  }

  async sync(): Promise<boolean> {
    const results = await Promise.all([
      new Promise<boolean>(async (resolve) => {
        let result = false;
        try {
          await this.downloadQueue.reset();
          const latestHeight = this.node.blockchain.latestHeight;
          let bestHeight = latestHeight;
          let best: Peer | undefined;
          for (const peer of this.node.peerpool.peers) {
            const height = peer.latestHeight(constants.GXC2_ETHWIRE);
            if (height > bestHeight) {
              best = peer;
              bestHeight = height;
            }
          }
          if (best) {
            let totalCount = bestHeight - latestHeight;
            let i = 0;
            while (totalCount > 0) {
              this.downloadQueue.insert({
                start: i * this.count + latestHeight + 1,
                count: totalCount > this.count ? this.count : totalCount - this.count
              });
              totalCount -= this.count;
              i++;
            }
            await this.downloadQueue.start();
            result = true;
          }
          // push null to result queue, exit the async generator loop.
          this.resultQueue.push(null);
        } catch (err) {
          console.error('Sync download error', err);
          this.emit('error', err);
        } finally {
          resolve(result);
        }
      }),
      new Promise<boolean>(async (resolve) => {
        let result = false;
        try {
          await this.processResult();
          result = true;
        } catch (err) {
          console.error('Sync process result error', err);
          this.emit('error', err);
        } finally {
          resolve(result);
        }
      })
    ]);

    return results.reduce((a, b) => a && b);
  }

  async abort() {
    await this.downloadQueue.abort();
    await super.abort();
  }

  async reset() {
    await this.downloadQueue.reset();
    await super.reset();
  }
}
