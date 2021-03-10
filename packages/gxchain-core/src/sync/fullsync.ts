import Semaphore from 'semaphore-async-await';
import { constants } from '@gxchain2/common';
import { Peer, PeerRequestTimeoutError } from '@gxchain2/network';
import { Block, BlockHeader } from '@gxchain2/block';
import { Synchronizer, SynchronizerOptions } from './sync';
import { Fetcher } from './fetcher';
import { AsyncChannel, logger } from '@gxchain2/utils';

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
  private abortFetcher?: () => void;
  private lock = new Semaphore(1);

  constructor(options: FullSynchronizerOptions) {
    super(options);
    this.options = options;
    this.count = this.options.count || 128;
  }

  get isSyncing(): boolean {
    return !!this.syncingPromise;
  }

  async announce(peer: Peer, height: number) {
    // TODO: validata block.
    if (!this.isSyncing) {
      this.sync({ peer, height });
    } else if (this.bestPeer && this.bestHeight !== undefined && height > this.bestHeight) {
      await this.lock.acquire();
      if (!this.isSyncing) {
        this.sync({ peer, height });
      } else if (this.bestPeer && this.bestHeight !== undefined && height > this.bestHeight) {
        await this.syncAbort();
        this.sync({ peer, height });
      }
      this.lock.release();
    }
  }

  protected async _sync(target?: { peer: Peer; height: number }): Promise<boolean> {
    if (this.syncingPromise) {
      throw new Error('FullSynchronizer already sync');
    }
    const syncResult = await (this.syncingPromise = new Promise<boolean>(async (syncResolve) => {
      const syncFailed = () => {
        syncResolve(false);
        this.bestHeight = undefined;
        this.bestPeer = undefined;
      };

      if (target) {
        this.bestHeight = target.height;
        this.bestPeer = target.peer;
        if (this.bestHeight <= this.node.blockchain.latestHeight) {
          syncFailed();
          return;
        }
      } else {
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
          syncFailed();
          return;
        }
      }

      if (!this.bestPeer.headersIdle) {
        syncFailed();
        return;
      }
      this.bestPeer.headersIdle = false;

      try {
        syncResolve(await this.syncWithPeer(this.bestPeer, this.bestHeight!));
        logger.info('💫 Sync over, local height:', this.node.blockchain.latestHeight, 'best height:', this.bestHeight);
      } catch (err) {
        syncResolve(false);
        this.emit('error', err);
      } finally {
        this.bestPeer.headersIdle = true;
        this.abortFetcher = undefined;
        this.bestHeight = undefined;
        this.bestPeer = undefined;
      }
    }));
    this.syncingPromise = undefined;
    return syncResult;
  }

  async syncAbort() {
    if (this.abortFetcher) {
      await this.abortFetcher();
    }
    if (this.syncingPromise) {
      await this.syncingPromise;
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
        headers = await peer.getBlockHeaders(latestHeight, this.count);
      } catch (err) {
        if (err instanceof PeerRequestTimeoutError) {
          this.node.peerpool.ban(peer, this.options.timeoutBanTime || 300000);
        } else {
          this.node.peerpool.ban(peer, this.options.errorBanTime || 60000);
        }
        throw err;
      }

      for (let i = headers.length - 1; i >= 0; i--) {
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

  private async syncWithPeer(peer: Peer, bestHeight: number): Promise<boolean> {
    const localHeight = await this.findAncient(peer);
    logger.info('💡 Get best height from:', peer.peerId, 'best height:', bestHeight, 'local height:', localHeight);
    this.startSyncHook(localHeight, bestHeight);

    let syncAbort = false;
    const blocksQueue = new AsyncChannel<Block>({ isAbort: () => syncAbort });
    const fetcher = new Fetcher({ node: this.node, limitCount: this.count });
    this.abortFetcher = () => {
      syncAbort = true;
      blocksQueue.abort();
      fetcher.abort();
    };
    fetcher.on('newBlock', (block: Block) => {
      blocksQueue.push(block);
    });
    let success = false;
    await Promise.all([
      fetcher.fetch(localHeight, bestHeight - localHeight, peer.peerId),
      new Promise<void>(async (resolve) => {
        for await (const block of blocksQueue.generator()) {
          try {
            await this.node.processBlock(block, true);
            if (block.header.number.eqn(this.bestHeight!)) {
              success = true;
              this.abortFetcher!();
              break;
            }
          } catch (err) {
            logger.error('FullSynchronizer::syncWithPeer, process block error:', err);
            this.abortFetcher!();
          }
        }
        resolve();
      })
    ]);
    this.abortFetcher = undefined;
    return success;
  }
}
