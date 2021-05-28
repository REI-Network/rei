import { BN } from 'ethereumjs-util';
import { constants } from '@gxchain2/common';
import { Peer, PeerRequestTimeoutError } from '@gxchain2/network';
import { BlockHeader } from '@gxchain2/block';
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
  private readonly fetcher: Fetcher;
  private bestPeer?: Peer;
  private bestHeight?: number;
  private bestTD?: BN;
  private syncingPromise?: Promise<boolean>;

  constructor(options: FullSynchronizerOptions) {
    super(options);
    this.count = options.count || 128;
    this.limit = options.limit || 16;
    this.timeoutBanTime = options.timeoutBanTime || 300000;
    this.errorBanTime = options.timeoutBanTime || 60000;
    this.invalidBanTime = options.invalidBanTime || 600000;
    this.fetcher = new Fetcher({ node: this.node, count: this.count, limit: this.limit!, banPeer: this.banPeer.bind(this) });
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
  announce(peer: Peer, height: number, td: BN) {
    if (!this.isSyncing && this.node.blockchain.totalDifficulty.lt(td)) {
      this.sync({ peer, height, td });
    }
  }

  protected async _sync(target?: { peer: Peer; height: number; td: BN }): Promise<boolean> {
    if (this.syncingPromise) {
      throw new Error('FullSynchronizer already sync');
    }
    const syncResult = await (this.syncingPromise = new Promise<boolean>(async (syncResolve) => {
      const syncFailed = () => {
        syncResolve(false);
        this.bestHeight = undefined;
        this.bestPeer = undefined;
        this.bestTD = undefined;
      };

      if (target) {
        this.bestHeight = target.height;
        this.bestPeer = target.peer;
        this.bestTD = target.td.clone();
        if (this.bestTD.lt(this.node.blockchain.totalDifficulty)) {
          syncFailed();
          return;
        }
      } else {
        this.bestTD = this.node.blockchain.totalDifficulty;
        for (const peer of this.node.peerpool.peers) {
          const remoteStatus = peer.getStatus(constants.GXC2_ETHWIRE);
          if (!remoteStatus) {
            continue;
          }
          const td = new BN(remoteStatus.totalDifficulty);
          if (td.gt(this.bestTD)) {
            this.bestPeer = peer;
            this.bestHeight = remoteStatus.height;
            this.bestTD = td;
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
        logger.info('💫 Sync over, local height:', this.node.blockchain.latestHeight, 'local td:', this.node.blockchain.totalDifficulty.toString(), 'best height:', this.bestHeight, 'best td:', this.bestTD.toString());
      } catch (err) {
        syncResolve(false);
        this.emit('error', err);
      } finally {
        this.bestPeer.headersIdle = true;
        this.bestHeight = undefined;
        this.bestPeer = undefined;
        this.bestTD = undefined;
      }
    }));
    this.syncingPromise = undefined;
    return syncResult;
  }

  /**
   * Abort the sync
   */
  async syncAbort() {
    this.fetcher.abort();
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
    if (localHeight >= bestHeight) {
      return false;
    }
    logger.info('💡 Get best height from:', peer.peerId, 'best height:', bestHeight, 'local height:', localHeight);
    this.startSyncHook(localHeight, bestHeight);

    this.fetcher.reset();
    await this.fetcher.fetch(localHeight, bestHeight - localHeight, peer.peerId);
    return true;
  }
}
