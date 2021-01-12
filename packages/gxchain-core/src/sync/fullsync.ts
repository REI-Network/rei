import { constants } from '@gxchain2/common';
import { Peer } from '@gxchain2/network';

import { Synchronizer, SynchronizerOptions } from './sync';
import { HeadersFetcher, BodiesFetcher, HeadersFethcerTask } from './fetcher';

export interface FullSynchronizerOptions extends SynchronizerOptions {
  limit?: number;
  count?: number;
  timeoutBanTime?: number;
  errorBanTime?: number;
}

export class FullSynchronizer extends Synchronizer {
  private readonly options: FullSynchronizerOptions;
  private readonly count: number;
  private syncingPromise?: Promise<boolean>;
  private abortFetchers?: () => Promise<void>;

  constructor(options: FullSynchronizerOptions) {
    super(options);
    this.options = options;
    this.count = this.options.count || 128;
  }

  async sync(): Promise<boolean> {
    if (this.syncingPromise) {
      throw new Error('FullSynchronizer already sync');
    }
    const syncResult = await (this.syncingPromise = new Promise<boolean>(async (syncResolve) => {
      let bestHeight = 0;
      const latestHeight = this.node.blockchain.latestHeight;
      bestHeight = latestHeight;
      let best: Peer | undefined;
      for (const peer of this.node.peerpool.peers) {
        const height = peer.latestHeight(constants.GXC2_ETHWIRE);
        if (height > bestHeight) {
          best = peer;
          bestHeight = height;
        }
      }
      if (!best) {
        syncResolve(false);
        return;
      }

      console.debug('get best height from:', best!.peerId, 'best height:', bestHeight, 'local height:', latestHeight);
      let totalCount = bestHeight - latestHeight;
      let totalTaskCount = 0;
      const headerFetcherTasks: HeadersFethcerTask[] = [];
      while (totalCount > 0) {
        headerFetcherTasks.push({
          data: {
            start: totalTaskCount * this.count + latestHeight + 1,
            count: totalCount > this.count ? this.count : totalCount
          },
          peer: best,
          index: totalTaskCount
        });
        totalTaskCount++;
        totalCount -= this.count;
      }

      const bodiesFetcher = new BodiesFetcher(
        Object.assign(this.options, {
          node: this.node,
          bestHeight
        })
      ).on('error', (err) => {
        console.error('bodiesFetcher error:', err);
        this.syncAbort();
      });

      const headerFetcher = new HeadersFetcher(
        Object.assign(this.options, {
          node: this.node,
          bestHeight
        })
      )
        .on('error', (err) => {
          console.error('headerFetcher error:', err);
          this.syncAbort();
        })
        .on('result', (task) => {
          bodiesFetcher.insert({ data: task.result!, index: task.index });
        });

      this.abortFetchers = async () => {
        await Promise.all([headerFetcher.reset(), bodiesFetcher.reset()]);
      };
      syncResolve((await Promise.all([headerFetcher.fetch(headerFetcherTasks), bodiesFetcher.fetch()])).reduce((a, b) => a && b, true));
    }));
    this.abortFetchers = undefined;
    this.syncingPromise = undefined;
    return syncResult;
  }

  async syncAbort() {
    if (this.abortFetchers) {
      await this.abortFetchers();
      this.abortFetchers = undefined;
    }
  }
}
