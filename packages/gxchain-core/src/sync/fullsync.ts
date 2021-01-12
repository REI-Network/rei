import { constants } from '@gxchain2/common';
import { Peer, PeerRequestTimeoutError } from '@gxchain2/network';
import { Block, BlockHeader } from '@gxchain2/block';
import { Transaction } from '@gxchain2/tx';

import { Synchronizer, SynchronizerOptions } from './sync';
import { Task, Fetcher } from './fetcher';
import { GXC2_ETHWIRE } from '@gxchain2/common/dist/constants';

export interface FullSynchronizerOptions extends SynchronizerOptions {
  limit?: number;
  count?: number;
  timeoutBanTime?: number;
  errorBanTime?: number;
}

type HeadersFethcerTaskData = { start: number; count: number };
type HeadersFethcerTask = Task<HeadersFethcerTaskData, BlockHeader[]>;
type BodiesFetcherTaskData = BlockHeader[];
type BodiesFetcherTask = Task<BodiesFetcherTaskData, Transaction[][]>;

export class FullSynchronizer extends Synchronizer {
  private readonly options: FullSynchronizerOptions;
  private readonly count: number;
  private readonly timeoutBanTime: number;
  private readonly errorBanTime: number;
  private syncingPromise?: Promise<boolean>;
  private abortFetchers?: () => Promise<void>;

  constructor(options: FullSynchronizerOptions) {
    super(options);
    this.options = options;
    this.count = this.options.count || 128;
    this.timeoutBanTime = options.timeoutBanTime || 300000;
    this.errorBanTime = options.errorBanTime || 60000;
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

      const bodiesFetcher = new Fetcher<BodiesFetcherTaskData, Transaction[][]>(
        Object.assign(this.options, {
          node: this.node,
          lockIdlePeer: (peer: Peer) => {
            peer.bodiesIdle = false;
          },
          findIdlePeer: () => {
            return this.node.peerpool.idle((p) => p.isSupport(GXC2_ETHWIRE) && p.bodiesIdle);
          },
          isValidPeer: (p) => p.isSupport(GXC2_ETHWIRE) && p.bodiesIdle,
          download: async (task: BodiesFetcherTask) => {
            const peer = task.peer!;
            try {
              const bodies: Transaction[][] = await peer.request(constants.GXC2_ETHWIRE, 'GetBlockBodies', task.data);
              // TODO: validate.
              peer.headersIdle = true;
              return bodies;
            } catch (err) {
              if (err instanceof PeerRequestTimeoutError) {
                this.node.peerpool.ban(peer, this.timeoutBanTime);
              } else {
                this.node.peerpool.ban(peer, this.errorBanTime);
              }
              peer.headersIdle = true;
              task.peer = undefined;
              throw err;
            }
          },
          process: async (task: BodiesFetcherTask) => {
            const result = task.result!;
            const blocks = task.data.map((header, i) =>
              Block.fromBlockData(
                {
                  header,
                  transactions: result[i]
                },
                { common: this.node.common }
              )
            );
            try {
              await this.node.processBlocks(blocks);
              return blocks[blocks.length - 1].header.number.toNumber() === bestHeight;
            } catch (err) {
              this.emit('error', err);
              this.syncAbort();
              return true;
            }
          }
        })
      ).on('error', (err) => {
        console.error('bodiesFetcher error:', err);
      });

      const headerFetcher = new Fetcher<HeadersFethcerTaskData, BlockHeader[]>(
        Object.assign(this.options, {
          node: this.node,
          lockIdlePeer: (peer: Peer) => {
            peer.headersIdle = false;
          },
          findIdlePeer: () => {
            return this.node.peerpool.idle((p) => p.isSupport(GXC2_ETHWIRE) && p.headersIdle);
          },
          isValidPeer: (p) => p.isSupport(GXC2_ETHWIRE) && p.headersIdle,
          download: async (task: HeadersFethcerTask) => {
            const peer = task.peer!;
            try {
              const headers: BlockHeader[] = await peer.getBlockHeaders(task.data.start, task.data.count);
              // TODO: validate.
              peer.headersIdle = true;
              return headers;
            } catch (err) {
              if (err instanceof PeerRequestTimeoutError) {
                this.node.peerpool.ban(peer, this.timeoutBanTime);
              } else {
                this.node.peerpool.ban(peer, this.errorBanTime);
              }
              peer.headersIdle = true;
              task.peer = undefined;
              throw err;
            }
          },
          process: async (task: HeadersFethcerTask) => {
            const result = task.result!;
            bodiesFetcher.insert({ data: result, index: task.index });
            return result[result.length - 1].number.toNumber() === bestHeight;
          }
        })
      ).on('error', (err) => {
        console.error('headerFetcher error:', err);
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
