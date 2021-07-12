import { BN } from 'ethereumjs-util';
import { Peer } from '@gxchain2/network';
import { BlockHeader } from '@gxchain2/structure';
import { logger, hexStringToBN } from '@gxchain2/utils';
import { Synchronizer, SynchronizerOptions } from './sync';
import { Fetcher } from './fetcher';
import { WireProtocol, WireProtocolHandler, PeerRequestTimeoutError, maxGetBlockHeaders } from '../protocols';

const defaultMaxLimit = 16;

export interface FullSynchronizerOptions extends SynchronizerOptions {
  limit?: number;
  count?: number;
}

export class FullSynchronizer extends Synchronizer {
  private readonly count: number;
  private readonly limit: number;
  private readonly fetcher: Fetcher;
  private syncingPromise?: Promise<boolean>;

  constructor(options: FullSynchronizerOptions) {
    super(options);
    this.count = options.count || maxGetBlockHeaders;
    this.limit = options.limit || defaultMaxLimit;
    this.fetcher = new Fetcher({ node: this.node, count: this.count, limit: this.limit });
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
      let bestPeerHandler!: WireProtocolHandler;
      let bestHeight!: number;
      let bestTD!: BN;

      if (peer) {
        bestPeerHandler = WireProtocol.getHandler(peer);
        bestHeight = bestPeerHandler.status!.height;
        bestTD = new BN(bestPeerHandler.status!.totalDifficulty);
        if (bestTD.lte(this.node.blockchain.totalDifficulty)) {
          return syncResolve(false);
        }
      } else {
        bestTD = this.node.blockchain.totalDifficulty;
        for (const handler of WireProtocol.getPool().handlers) {
          const remoteStatus = handler.status!;
          const td = new BN(remoteStatus.totalDifficulty);
          if (td.gt(bestTD)) {
            bestPeerHandler = handler;
            bestHeight = remoteStatus.height;
            bestTD = td;
          }
        }
        if (!bestPeerHandler) {
          return syncResolve(false);
        }
      }

      try {
        syncResolve(await this.syncWithPeerHandler(bestPeerHandler, bestHeight, bestTD));
        logger.info('💫 Sync over, local height:', this.node.blockchain.latestHeight, 'local td:', this.node.blockchain.totalDifficulty.toString(), 'best height:', bestHeight, 'best td:', bestTD.toString());
      } catch (err) {
        syncResolve(false);
        logger.error('FullSynchronizer::_sync, catch error:', err);
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

  private genesis(): [number, Buffer, BN] {
    return [0, this.node.status.genesisHash, hexStringToBN(this.node.getCommon(0).genesis().difficulty)];
  }

  // TODO: binary search.
  private async findAncient(handler: WireProtocolHandler): Promise<[number, Buffer, BN]> {
    let latestHeight = this.node.blockchain.latestHeight;
    if (latestHeight === 0) {
      return this.genesis();
    }
    while (latestHeight > 0) {
      const count = latestHeight >= this.count ? this.count : latestHeight;
      latestHeight -= count - 1;

      let headers!: BlockHeader[];
      try {
        headers = await handler.getBlockHeaders(latestHeight, this.count);
      } catch (err) {
        if (err instanceof PeerRequestTimeoutError) {
          await this.node.banPeer(handler.peer.peerId, 'timeout');
        }
        throw err;
      }

      for (let i = headers.length - 1; i >= 0; i--) {
        try {
          const remoteHeader = headers[i];
          const hash = remoteHeader.hash();
          const localHeader = await this.node.db.getHeader(hash, remoteHeader.number);
          const localTD = await this.node.db.getTotalDifficulty(hash, remoteHeader.number);
          return [localHeader.number.toNumber(), hash, localTD];
        } catch (err) {
          if (err.type === 'NotFoundError') {
            continue;
          }
          throw err;
        }
      }

      if (latestHeight === 1) {
        return this.genesis();
      }
    }
    throw new Error('find acient failed');
  }

  private async syncWithPeerHandler(handler: WireProtocolHandler, bestHeight: number, bestTD: BN): Promise<boolean> {
    const [localHeight, localHash, localTD] = await this.findAncient(handler);
    if (localHeight >= bestHeight) {
      return false;
    }
    logger.info('💡 Get best height from:', handler.peer.peerId, 'best height:', bestHeight, 'local height:', localHeight);
    this.startSyncHook(localHeight, bestHeight);

    this.fetcher.reset();
    await this.fetcher.fetch(localHeight, localHash, localTD, bestHeight, bestTD, handler);
    return true;
  }
}
