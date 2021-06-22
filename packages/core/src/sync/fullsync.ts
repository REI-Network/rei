import { BN } from 'ethereumjs-util';
import { Peer } from '@gxchain2/network';
import { BlockHeader } from '@gxchain2/structure';
import { logger } from '@gxchain2/utils';
import { Synchronizer, SynchronizerOptions } from './sync';
import { Fetcher } from './fetcher';
import { WireProtocol, WireProtocolHandler, PeerRequestTimeoutError } from '../protocols';

export interface FullSynchronizerOptions extends SynchronizerOptions {
  limit?: number;
  count?: number;
}

export class FullSynchronizer extends Synchronizer {
  private readonly count: number;
  private readonly limit: number;
  private readonly fetcher: Fetcher;

  private bestPeerHandler?: WireProtocolHandler;
  private bestHeight?: number;
  private bestTD?: BN;
  private syncingPromise?: Promise<boolean>;

  constructor(options: FullSynchronizerOptions) {
    super(options);
    this.count = options.count || 128;
    this.limit = options.limit || 16;
    this.fetcher = new Fetcher({ node: this.node, count: this.count, limit: this.limit });
  }

  /**
   * Judge the sync state
   */
  get isSyncing(): boolean {
    return !!this.syncingPromise;
  }

  /**
   * Syncing switch to the peer if the peer's block height is more than the bestHeight
   * @param peer - remote peer
   */
  announce(peer: Peer) {
    const handler = WireProtocol.getHandler(peer);
    if (handler && !this.isSyncing && this.node.blockchain.totalDifficulty.lt(new BN(handler.status!.totalDifficulty))) {
      this.sync(peer);
    }
  }

  protected async _sync(peer?: Peer): Promise<boolean> {
    if (this.syncingPromise) {
      throw new Error('FullSynchronizer already sync');
    }
    const syncResult = await (this.syncingPromise = new Promise<boolean>(async (syncResolve) => {
      const syncFailed = () => {
        syncResolve(false);
        this.bestHeight = undefined;
        this.bestPeerHandler = undefined;
        this.bestTD = undefined;
      };

      if (peer) {
        this.bestPeerHandler = WireProtocol.getHandler(peer);
        this.bestHeight = this.bestPeerHandler.status!.height;
        this.bestTD = new BN(this.bestPeerHandler.status!.totalDifficulty);
        if (this.bestTD.lt(this.node.blockchain.totalDifficulty)) {
          syncFailed();
          return;
        }
      } else {
        this.bestTD = this.node.blockchain.totalDifficulty;
        for (const handler of WireProtocol.getPool().handlers) {
          const remoteStatus = handler.status!;
          const td = new BN(remoteStatus.totalDifficulty);
          if (td.gt(this.bestTD)) {
            this.bestPeerHandler = handler;
            this.bestHeight = remoteStatus.height;
            this.bestTD = td;
          }
        }
        if (!this.bestPeerHandler) {
          syncFailed();
          return;
        }
      }

      try {
        syncResolve(await this.syncWithPeerHandler(this.bestPeerHandler, this.bestHeight!));
        logger.info('💫 Sync over, local height:', this.node.blockchain.latestHeight, 'local td:', this.node.blockchain.totalDifficulty.toString(), 'best height:', this.bestHeight, 'best td:', this.bestTD.toString());
      } catch (err) {
        syncResolve(false);
        logger.error('FullSynchronizer::_sync, catch error:', err);
      } finally {
        this.bestHeight = undefined;
        this.bestPeerHandler = undefined;
        this.bestTD = undefined;
      }
    }));
    this.syncingPromise = undefined;
    return syncResult;
  }

  /**
   * Abort the sync
   */
  async abort() {
    this.fetcher.abort();
    if (this.syncingPromise) {
      await this.syncingPromise;
    }
  }

  // TODO: binary search.
  private async findAncient(handler: WireProtocolHandler): Promise<number> {
    let latestHeight = this.node.blockchain.latestHeight;
    if (latestHeight === 0) {
      return 0;
    }
    while (latestHeight > 0) {
      const count = latestHeight >= this.count ? this.count : latestHeight;
      latestHeight -= count;

      let headers!: BlockHeader[];
      try {
        headers = await handler.getBlockHeaders(latestHeight, this.count);
      } catch (err) {
        await this.node.banPeer(handler.peer.peerId, err instanceof PeerRequestTimeoutError ? 'timeout' : 'error');
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

  private async syncWithPeerHandler(handler: WireProtocolHandler, bestHeight: number): Promise<boolean> {
    const localHeight = await this.findAncient(handler);
    if (localHeight >= bestHeight) {
      return false;
    }
    logger.info('💡 Get best height from:', handler.peer.peerId, 'best height:', bestHeight, 'local height:', localHeight);
    this.startSyncHook(localHeight, bestHeight);

    this.fetcher.reset();
    await this.fetcher.fetch(localHeight, bestHeight - localHeight, handler);
    return true;
  }
}
