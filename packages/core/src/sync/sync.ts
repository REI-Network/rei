import { EventEmitter } from 'events';
import { BN } from 'ethereumjs-util';
import {
  Channel,
  getRandomIntInclusive,
  logger,
  AbortableTimer
} from '@rei-network/utils';
import { Block } from '@rei-network/structure';
import { Node } from '../node';
import { preValidateBlock, validateReceipts } from '../validation';
import { WireProtocolHandler, isV2, SnapProtocolHandler } from '../protocols';
import { SnapSyncScheduler } from './snap';
import { FullSyncScheduler } from './full';
import { SyncInfo, BlockData } from './types';

const snapSyncStaleBlockNumber = 128;
const snapSyncTrustedStaleBlockNumber = 896;
const snapSyncMinConfirmed = 2;
const waitingSyncDelay = 200;
const randomPickInterval = 1000;
// about 1 week
const defaultSnapSyncMinTD = 201600;

export enum AnnouncementType {
  NewPeer,
  NewBlock
}

type SnapAnnouncement = {
  type: AnnouncementType;
  handler: SnapProtocolHandler;
};

type WireAnnouncement = {
  type: AnnouncementType;
  handler: WireProtocolHandler;
  block?: Block;
  height: BN;
  td: BN;
};

export type Announcement = SnapAnnouncement | WireAnnouncement;

function isWireAnnouncement(ann: Announcement): ann is WireAnnouncement {
  return !(ann.handler instanceof SnapProtocolHandler);
}

export enum SyncMode {
  Full = 'full',
  Snap = 'snap'
}

export interface SynchronizerOptions {
  node: Node;
  mode: SyncMode;
  snapSyncMinTD?: number;
  trustedHeight?: BN;
  trustedHash?: Buffer;
}

export declare interface Synchronizer {
  on(event: 'start', listener: () => void): this;
  on(event: 'finished', listener: () => void): this;
  on(event: 'synchronized', listener: () => void): this;
  on(event: 'failed', listener: () => void): this;

  off(event: 'start', listener: () => void): this;
  off(event: 'finished', listener: () => void): this;
  off(event: 'synchronized', listener: () => void): this;
  off(event: 'failed', listener: () => void): this;
}

export class Synchronizer extends EventEmitter {
  readonly node: Node;
  readonly mode: SyncMode;
  private full: FullSyncScheduler;
  private snap: SnapSyncScheduler;
  private channel = new Channel<Announcement>();
  private aborted = false;
  private delay = new AbortableTimer();
  private timer = new AbortableTimer();
  private syncLoopPromise?: Promise<void>;
  private randomPickLoopPromise?: Promise<void>;
  private trustedHeight?: BN;
  private trustedHash?: Buffer;
  private snapSyncMinTD: number;

  constructor(options: SynchronizerOptions) {
    super();
    this.node = options.node;
    this.mode = options.mode;
    this.snapSyncMinTD = options.snapSyncMinTD ?? defaultSnapSyncMinTD;
    this.trustedHash = options.trustedHash;
    this.trustedHeight = options.trustedHeight;
    this.full = new FullSyncScheduler(options.node);
    this.snap = new SnapSyncScheduler(options.node);
    this.listenSyncer(this.full);
    this.listenSyncer(this.snap);
  }

  get status() {
    if (this.full.isSyncing) {
      return this.full.status;
    }
    if (this.snap.isSyncing) {
      return this.snap.status;
    }
    return { startingBlock: 0, highestBlock: 0 };
  }

  get isSyncing() {
    return this.full.isSyncing || this.snap.isSyncing;
  }

  get isWorking() {
    return !!this.syncLoopPromise;
  }

  /**
   * Listen syncer event
   * @param sync - Syncer instance
   */
  private listenSyncer(sync: FullSyncScheduler | SnapSyncScheduler) {
    sync
      .on('start', (info) => {
        logger.info(
          '💡 Get best height from:',
          info.remotePeerId,
          'best height:',
          info.bestHeight.toString(),
          'local height:',
          this.node.latestBlock.header.number.toString()
        );
        this.emit('start');
      })
      .on('finished', (info) => {
        const localHeight = this.node.latestBlock.header.number.toString();
        const localTD = this.node.getTotalDifficulty().toString();
        logger.info(
          '💫 Sync over, local height:',
          localHeight,
          'local td:',
          localTD,
          'best height:',
          info.bestHeight.toString(),
          'best td:',
          info.bestTD.toString()
        );
        this.emit('finished');
      })
      .on('synchronized', () => {
        const latest = this.node.latestBlock;
        const td = this.node.getTotalDifficulty();
        this.node.wire.broadcastNewBlock(latest, td);
        logger.info('💫 Synchronized');
        this.emit('synchronized');
      })
      .on('failed', () => {
        this.emit('failed');
      });
  }

  /**
   * Download block and receipts through announcement
   * @param ann - Wire announcement
   * @returns If the download failed, return null
   */
  private downloadBlockDataFromAnn(
    ann: WireAnnouncement
  ): Promise<BlockData | null> {
    return this.downloadBlockData(ann.height, ann.handler, ann.block);
  }

  /**
   * Download block and receipts
   * @param height - Best height
   * @param handler - Handler instance
   * @param block - Block(if exists)
   * @returns If the download failed, return null
   */
  private async downloadBlockData(
    height: BN,
    handler: WireProtocolHandler,
    block?: Block
  ): Promise<BlockData | null> {
    if (!isV2(handler)) {
      // the remote peer must support wire v2 protocol
      logger.debug(
        'Synchronizer::downloadBlockData, unsupported wire v2 protocol:',
        handler.id
      );
      return null;
    }

    if (!block) {
      // download header
      const header = await handler
        .getBlockHeaders(height, new BN(1))
        .then((headers) => (headers.length === 1 ? headers[0] : null))
        .catch(() => null);
      if (header === null) {
        logger.warn(
          'Synchronizer::downloadBlockData, download header failed:',
          handler.id,
          'number:',
          height.toString()
        );
        return null;
      }

      // download body
      const body = await handler
        .getBlockBodies([header])
        .then((body) => (body.length === 1 ? body[0] : null))
        .catch(() => null);
      if (body === null) {
        logger.warn(
          'Synchronizer::downloadBlockData, download body failed:',
          handler.id,
          'number:',
          height.toString()
        );
        return null;
      }

      block = Block.fromBlockData(
        { header, transactions: body },
        { common: this.node.getCommon(0), hardforkByBlockNumber: true }
      );
    }

    // validate block
    try {
      await preValidateBlock.call(block);
    } catch (err) {
      // maybe we should ban remote peer
      logger.warn(
        'Synchronizer::downloadBlockData, validate block failed:',
        handler.id,
        'err:',
        err
      );
      return null;
    }

    // download receipts
    const receipts = await handler
      .getReceipts([block.hash()])
      .then((receipts) => (receipts.length === 1 ? receipts[0] : null))
      .catch(() => null);
    if (receipts === null) {
      logger.warn(
        'Synchronizer::downloadBlockData, download receipts failed:',
        handler.id,
        'number:',
        height.toString()
      );
      return null;
    }

    // validate receipts
    try {
      await validateReceipts(block, receipts);
    } catch (err) {
      // maybe we should ban remote peer
      logger.warn(
        'Synchronizer::downloadBlockData, validate receipts failed:',
        handler.id,
        'err:',
        err
      );
      return null;
    }

    return { block, receipts };
  }

  /**
   * Compare blockData for equality
   * @param a - BlockData
   * @param b - BlockData
   * @returns Return true if equal
   */
  private compareBlockData(a: BlockData, b: BlockData) {
    if (!a.block.serialize().equals(b.block.serialize())) {
      return false;
    }
    if (a.receipts.length !== b.receipts.length) {
      return false;
    }
    for (let i = 0; i < a.receipts.length; i++) {
      if (!a.receipts[i].serialize().equals(b.receipts[i].serialize())) {
        return false;
      }
    }
    return true;
  }

  /**
   * Confirm the trusted block
   * @param handler - Remote peer handler
   * @returns is it confirmed and block data
   */
  private async confirmTrusted(handler: WireProtocolHandler) {
    const data = await this.downloadBlockData(this.trustedHeight!, handler);
    const confirmed = data && data.block.hash().equals(this.trustedHash!);
    return { confirmed: !!confirmed, data };
  }

  /**
   * Confirm the latest block data for snap sync
   * @param ann - Wire announcement
   * @returns confirmed peers count and block data
   */
  private async confirmAnn(ann: WireAnnouncement) {
    const data = await this.downloadBlockDataFromAnn(ann);
    if (data === null) {
      // download data failed,
      // maybe we should ban the remote peer
      return null;
    }

    // sleep for a while to ensure
    // the block has been synced by other peers
    await this.delay.wait(waitingSyncDelay);
    if (this.aborted) {
      // exit if we have aborted
      return null;
    }

    let confirmed = 0;
    // TODO: random pick handler
    for (const handler of this.node.wire.pool.handlers) {
      if (handler.peer.peerId === ann.handler.peer.peerId) {
        // ignore the current peer
        continue;
      }

      if (!isV2(handler)) {
        // ignore v1 peer
        continue;
      }

      const _data = await this.downloadBlockData(ann.height, handler);
      if (_data !== null && this.compareBlockData(data, _data)) {
        if (++confirmed >= 2) {
          break;
        }
      }
    }

    return { confirmed, data };
  }

  private async syncLoop() {
    for await (const ann of this.channel) {
      if (this.full.isSyncing) {
        // full sync is working, ignore all announcement
        continue;
      }

      if (!isWireAnnouncement(ann)) {
        if (ann.type === AnnouncementType.NewPeer && this.snap.isSyncing) {
          // snap sync is working, announce a new peer to it
          this.snap.snapSyncer.announce();
        }
        continue;
      }

      // check if we need to notify snap of the latest stateRoot
      if (this.snap.isSyncing && !this.snap.snapSyncer.snapped) {
        const remoteHeight = ann.height.toNumber();
        const localHeight = this.snap.status.highestBlock;
        const staleNumber = remoteHeight - localHeight;
        const trustedMode =
          this.trustedHeight &&
          this.trustedHash &&
          this.trustedHeight.eqn(localHeight);
        if (
          (trustedMode && staleNumber >= snapSyncTrustedStaleBlockNumber) ||
          (!trustedMode && staleNumber >= snapSyncStaleBlockNumber)
        ) {
          // confirm the latest block data, then reset the stateRoot of the snap
          const result = await this.confirmAnn(ann);
          if (result === null) {
            continue;
          }
          const { confirmed, data } = result;
          if (confirmed >= snapSyncMinConfirmed) {
            logger.info(
              'Synchronizer::syncLoop, current block is stale, try to sync new block:',
              remoteHeight
            );
            const root = data.block.header.stateRoot;
            const info: SyncInfo = {
              bestHeight: ann.height,
              bestTD: ann.height.addn(1),
              remotePeerId: ann.handler.peer.peerId
            };
            const startingBlock =
              this.node.latestBlock.header.number.toNumber();
            await this.snap.resetRoot(root, startingBlock, info, data);
            continue;
          }
        }
      }

      // we are not working, try to start a new sync
      if (!this.full.isSyncing && !this.snap.isSyncing) {
        const td = this.node.getTotalDifficulty();
        if (td.gte(ann.td)) {
          // the remote peer is behind, ignore
          continue;
        }

        if (
          this.mode === SyncMode.Snap &&
          ann.td.sub(td).gten(this.snapSyncMinTD)
        ) {
          if (!isV2(ann.handler)) {
            // the remote node does not support downloading receipts, ignore it
            continue;
          }

          logger.debug('Synchronizer::syncLoop, try to start a new snap sync');

          let data: BlockData;
          if (
            this.trustedHeight &&
            this.trustedHash &&
            this.node.latestBlock.header.number.lt(this.trustedHeight)
          ) {
            const result = await this.confirmTrusted(ann.handler);
            if (!result.confirmed || result.data === null) {
              logger.debug(
                'Synchronizer::syncLoop, trusted block confirmed failed'
              );
              continue;
            }

            logger.debug(
              'Synchronizer::syncLoop, trusted block confirmed succeed'
            );

            data = result.data;
          } else {
            // download data from other nodes to confirm the data
            const result = await this.confirmAnn(ann);
            if (result === null) {
              continue;
            }

            // if we have collected enough confirmations, start snap sync
            if (result.confirmed < snapSyncMinConfirmed) {
              logger.debug(
                'Synchronizer::syncLoop, confirmed failed:',
                result.confirmed
              );
              continue;
            }

            logger.debug('Synchronizer::syncLoop, confirmed succeed');

            data = result.data;
          }

          const header = data.block.header;
          const root = header.stateRoot;
          const info: SyncInfo = {
            bestHeight: header.number.clone(),
            bestTD: header.number.addn(1),
            remotePeerId: ann.handler.peer.peerId
          };
          const startingBlock = this.node.latestBlock.header.number.toNumber();
          await this.snap.snapSync(root, startingBlock, info, data);
        } else {
          logger.debug('Synchronizer::syncLoop, try to start a new full sync');
          // we're not too far behind, try full sync
          await this.full.fullSync(ann.handler);
        }
      }
    }
  }

  private async randomPickLoop() {
    while (!this.aborted) {
      await this.timer.wait(randomPickInterval);
      if (this.aborted) {
        // exit if we have aborted
        break;
      }

      // if we are not working, and there are no events that are not handled
      if (
        !this.full.isSyncing &&
        !this.snap.isSyncing &&
        this.channel.array.length === 0
      ) {
        const td = this.node.getTotalDifficulty();
        const handlers = this.node.wire.pool.handlers.filter((handler) =>
          new BN(handler.status!.totalDifficulty).gt(td)
        );
        if (handlers.length === 0) {
          continue;
        }

        // randomly pick a peer to start sync
        this.announceNewBlock(
          handlers[getRandomIntInclusive(0, handlers.length - 1)]
        );
      }
    }
  }

  /**
   * Announce a new block to syncer
   * @param handler - Handler instance
   * @param block - Block
   */
  announceNewBlock(handler: WireProtocolHandler, block?: Block) {
    this.channel.push({
      type: AnnouncementType.NewBlock,
      handler,
      block,
      height: new BN(handler.status!.height),
      td: new BN(handler.status!.totalDifficulty)
    });
  }

  /**
   * Announce syncer when a new peer joins
   * @param handler - Handler instance
   */
  announceNewPeer(handler: WireProtocolHandler | SnapProtocolHandler) {
    if (handler instanceof WireProtocolHandler) {
      this.channel.push({
        type: AnnouncementType.NewPeer,
        handler,
        height: new BN(handler.status!.height),
        td: new BN(handler.status!.totalDifficulty)
      });
    } else {
      this.channel.push({
        type: AnnouncementType.NewPeer,
        handler
      });
    }
  }

  /**
   * Start working
   */
  start() {
    if (this.isWorking) {
      throw new Error('syncer is working');
    }

    this.syncLoopPromise = this.syncLoop().finally(() => {
      this.syncLoopPromise = undefined;
    });
    this.randomPickLoopPromise = this.randomPickLoop().finally(() => {
      this.randomPickLoopPromise = undefined;
    });
  }

  /**
   * Abort
   */
  async abort() {
    if (this.isWorking) {
      this.aborted = true;
      this.timer.abort();
      this.delay.abort();
      this.channel.abort();
      if (this.full.isSyncing) {
        await this.full.abort();
      }
      if (this.snap.isSyncing) {
        await this.snap.abort();
      }
      this.full.removeAllListeners();
      this.snap.removeAllListeners();
      await this.syncLoopPromise;
      await this.randomPickLoopPromise;
    }
  }
}
