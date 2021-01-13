import { constants } from '@gxchain2/common';
import { Peer, PeerRequestTimeoutError } from '@gxchain2/network';
import { Block, BlockHeader } from '@gxchain2/block';

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
  private bestPeer?: Peer;
  private bestHeight?: number;
  private syncingPromise?: Promise<boolean>;
  private abortFetchers?: () => Promise<void>;

  constructor(options: FullSynchronizerOptions) {
    super(options);
    this.options = options;
    this.count = this.options.count || 128;
  }

  announce(peer: Peer, block: Block) {
    // TODO: validata block.
  }

  async sync(): Promise<boolean> {
    if (this.syncingPromise) {
      throw new Error('FullSynchronizer already sync');
    }
    const syncResult = await (this.syncingPromise = new Promise<boolean>(async (syncResolve) => {
      this.bestHeight = this.node.blockchain.latestHeight;
      for (const peer of this.node.peerpool.peers) {
        const remoteStatus = peer.getStatus(constants.GXC2_ETHWIRE);
        if (!remoteStatus) {
          continue;
        }
        const height = remoteStatus.height;
        if (height > this.bestHeight!) {
          this.bestPeer = peer;
          this.bestHeight = height;
        }
      }
      if (!this.bestPeer) {
        syncResolve(false);
        this.bestHeight = undefined;
        this.bestPeer = undefined;
        return;
      }

      try {
        syncResolve(
          await this.syncWithPeer(this.bestPeer, this.bestHeight!, (newAbort) => {
            this.abortFetchers = newAbort;
          })
        );
      } catch (err) {
        syncResolve(false);
        this.emit('error', err);
      } finally {
        this.bestHeight = undefined;
        this.bestPeer = undefined;
      }
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

  // TODO: binary search and rollback lock.
  private async findAncient(peer: Peer): Promise<number> {
    let latestHeight = this.node.blockchain.latestHeight;
    if (latestHeight === 0) {
      return 0;
    }
    while (latestHeight > 0) {
      const count = latestHeight >= this.count ? this.count : latestHeight;
      latestHeight -= count;

      let headers!: BlockHeader[];
      try {
        headers = await peer.getBlockHeaders(latestHeight, count);
      } catch (err) {
        if (err instanceof PeerRequestTimeoutError) {
          this.node.peerpool.ban(peer, this.options.timeoutBanTime || 300000);
        } else {
          this.node.peerpool.ban(peer, this.options.errorBanTime || 60000);
        }
        throw err;
      }

      for (let i = headers.length - 1; i > 0; i--) {
        try {
          const remoteHeader = headers[i];
          const localHeader = await this.node.db.getHeader(remoteHeader.hash(), remoteHeader.number);
          return localHeader.number.toNumber();
        } catch (err) {
          if (err.type === 'NotFoundError') {
            continue;
          }
          throw err;
        }
      }
    }
    throw new Error('find acient failed');
  }

  private async syncWithPeer(peer: Peer, bestHeight: number, updateAbort: (newAbort: () => Promise<void>) => void): Promise<boolean> {
    const localHeight = await this.findAncient(peer);
    console.debug('get best height from:', peer.peerId, 'best height:', bestHeight, 'local height:', localHeight);
    let totalCount = bestHeight - localHeight;
    let totalTaskCount = 0;
    const headerFetcherTasks: HeadersFethcerTask[] = [];
    while (totalCount > 0) {
      headerFetcherTasks.push({
        data: {
          start: totalTaskCount * this.count + localHeight + 1,
          count: totalCount > this.count ? this.count : totalCount
        },
        peer: peer,
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

    updateAbort(async () => {
      await Promise.all([headerFetcher.reset(), bodiesFetcher.reset()]);
    });
    return (await Promise.all([headerFetcher.fetch(headerFetcherTasks), bodiesFetcher.fetch()])).reduce((a, b) => a && b, true);
  }
}
