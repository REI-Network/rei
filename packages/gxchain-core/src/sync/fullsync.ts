import { constants } from '@gxchain2/common';
import { Peer, PeerRequestTimeoutError } from '@gxchain2/network';
import { Block, BlockHeader } from '@gxchain2/block';
import { Synchronizer, SynchronizerOptions } from './sync';
import { Fetcher } from './fetcher';
import { logger } from '@gxchain2/utils';

export interface FullSynchronizerOptions extends SynchronizerOptions {
  limit?: number;
  count?: number;
  timeoutBanTime?: number;
  errorBanTime?: number;
  invalidBanTime?: number;
}

export class FullSynchronizer extends Synchronizer {
  private readonly count: number;
  private readonly limit: number;
  private readonly timeoutBanTime: number;
  private readonly errorBanTime: number;
  private readonly invalidBanTime: number;
  private bestPeer?: Peer;
  private bestHeight?: number;
  private syncingPromise?: Promise<boolean>;
  private abortFetcher?: () => void;

  constructor(options: FullSynchronizerOptions) {
    super(options);
    this.count = options.count || 128;
    this.limit = options.limit || 16;
    this.timeoutBanTime = options.timeoutBanTime || 300000;
    this.errorBanTime = options.timeoutBanTime || 60000;
    this.invalidBanTime = options.invalidBanTime || 600000;
  }

  /**
   * Judge the sync state
   */
  get isSyncing(): boolean {
    return !!this.syncingPromise;
  }

  /**
   * Syncing switch to the peer if the peer's block height is more than the bestHeight
   * @param peer - the syncing peer
   * @param height - the height of block
   */
  announce(peer: Peer, height: number) {
    if (!this.isSyncing && this.node.blockchain.latestHeight < height) {
      this.sync({ peer, height });
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

  /**
   * Abort the sync
   */
  async syncAbort() {
    if (this.abortFetcher) {
      this.abortFetcher();
    }
    if (this.syncingPromise) {
      await this.syncingPromise;
    }
  }

  // TODO: this method should be removed.
  banPeer(peer: Peer, reason: 'invalid' | 'timeout' | 'error') {
    if (reason === 'invalid') {
      this.node.peerpool.ban(peer, this.invalidBanTime);
    } else if (reason === 'error') {
      this.node.peerpool.ban(peer, this.errorBanTime);
    } else {
      this.node.peerpool.ban(peer, this.timeoutBanTime);
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
        this.banPeer(peer, err instanceof PeerRequestTimeoutError ? 'timeout' : 'error');
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
    let success = false;
    const fetcher = new Fetcher({ node: this.node, count: this.count, limit: this.limit!, banPeer: this.banPeer.bind(this) });
    await Promise.all([
      new Promise<void>((resolve) => {
        this.abortFetcher = () => {
          syncAbort = true;
          resolve();
          fetcher.abort();
          fetcher.removeAllListeners();
        };
        fetcher.on('newBlock', (block: Block) => {
          if (syncAbort) {
            return;
          }
          this.node
            .processBlock(block, false)
            .then(() => {
              if (!syncAbort && block.header.number.eqn(bestHeight)) {
                if (this.abortFetcher) {
                  this.abortFetcher();
                }
                success = true;
                resolve();
              }
            })
            .catch((err) => {
              logger.error('FullSynchronizer::syncWithPeer, process block error:', err);
              if (this.abortFetcher) {
                this.abortFetcher();
              }
              resolve();
            });
        });
      }),
      fetcher.fetch(localHeight, bestHeight - localHeight, peer.peerId)
    ]);
    this.abortFetcher = undefined;
    return success;
  }
}
