import { EventEmitter } from 'events';
import { BN } from 'ethereumjs-util';
import { Channel, getRandomIntInclusive, logger, AbortableTimer } from '@rei-network/utils';
import { Block, Receipt } from '@rei-network/structure';
import { Node } from '../node';
import { preValidateBlock, validateReceipts } from '../validation';
import { WireProtocolHandler, isV2 } from '../protocols';
import { FullSync } from './full';
import { SnapSync } from './snap';
import { SyncInfo } from './types';

const snapSyncMinTD = 201600;
const waitingSyncDelay = 100;
const randomPickInterval = 1000;

export enum AnnouncementType {
  NewPeer,
  NewBlock
}

export type Announcement = {
  type: AnnouncementType;
  handler: WireProtocolHandler;
  block?: Block;
  height: BN;
  td: BN;
};

export type BlockData = {
  block: Block;
  receipts: Receipt[];
};

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
  private full: FullSync;
  private snap: SnapSync;
  private channel = new Channel<Announcement>();
  private aborted: boolean = false;
  private delay = new AbortableTimer();
  private timer = new AbortableTimer();
  private syncLoopPromise?: Promise<void>;
  private randomPickLoopPromise?: Promise<void>;

  constructor(node: Node) {
    super();
    this.node = node;
    this.full = new FullSync(node);
    this.snap = new SnapSync(this.node.db, 1 as any); // TODO
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
  private listenSyncer(sync: FullSync | SnapSync) {
    sync
      .on('start', (info) => {
        logger.info('💡 Get best height from:', info.remotePeerId, 'best height:', info.bestHeight.toString(), 'local height:', this.node.latestBlock.header.number.toString());
        this.emit('start');
      })
      .on('finished', (info) => {
        const localHeight = this.node.latestBlock.header.number.toString();
        const localTD = this.node.getTotalDifficulty().toString();
        logger.info('💫 Sync over, local height:', localHeight, 'local td:', localTD, 'best height:', info.bestHeight.toString(), 'best td:', info.bestTD.toString());
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
   * @param ann - Announcement
   * @returns If the download failed, return null
   */
  private downloadBlockDataFromAnn(ann: Announcement): Promise<BlockData | null> {
    return this.downloadBlockData(ann.height, ann.handler, ann.block);
  }

  /**
   * Download block and receipts
   * @param height - Best height
   * @param handler - Handler instance
   * @param _block - Block(if exists)
   * @returns If the download failed, return null
   */
  private async downloadBlockData(height: BN, handler: WireProtocolHandler, _block?: Block): Promise<BlockData | null> {
    if (!isV2(handler)) {
      // the remote peer must support wire v2 protocol
      logger.debug('Synchronizer::downloadBlockData, unsupported wire v2 protocol:', handler.id);
      return null;
    }

    let block!: Block;
    if (_block) {
      block = _block;
    } else {
      // download header
      const header = await handler
        .getBlockHeaders(height, new BN(1))
        .then((headers) => (headers.length === 1 ? headers[0] : null))
        .catch(() => null);
      if (header === null) {
        logger.warn('Synchronizer::downloadBlockData, download header failed:', handler.id, 'number:', height.toString());
        return null;
      }

      // download body
      const body = await handler
        .getBlockBodies([header])
        .then((body) => (body.length === 1 ? body[0] : null))
        .catch(() => null);
      if (body === null) {
        logger.warn('Synchronizer::downloadBlockData, download body failed:', handler.id, 'number:', height.toString());
        return null;
      }

      block = Block.fromBlockData({ header, transactions: body }, { common: this.node.getCommon(0), hardforkByBlockNumber: true });
    }

    // validate block
    try {
      await preValidateBlock.call(block);
    } catch (err) {
      // maybe we should ban remote peer
      logger.warn('Synchronizer::downloadBlockData, validate block failed:', handler.id, 'err:', err);
      return null;
    }

    // download receipts
    const receipts = await handler
      .getReceipts([block.hash()])
      .then((receipts) => (receipts.length === 1 ? receipts[0] : null))
      .catch(() => null);
    if (receipts === null) {
      logger.warn('Synchronizer::downloadBlockData, download receipts failed:', handler.id, 'number:', height.toString());
      return null;
    }

    // validate receipts
    try {
      validateReceipts(block, receipts);
    } catch (err) {
      // maybe we should ban remote peer
      logger.warn('Synchronizer::downloadBlockData, validate receipts failed:', handler.id, 'err:', err);
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

  private async syncLoop() {
    for await (const ann of this.channel) {
      if (this.full.isSyncing) {
        // full sync is working, ignore all announcement
        continue;
      }

      if (ann.type === AnnouncementType.NewPeer && this.snap.isSyncing) {
        // snap sync is working, announce a new peer to it
        this.snap.announce();
        continue;
      }

      // we are not working, try to start a new sync
      if (!this.full.isSyncing && !this.snap.isSyncing) {
        const td = this.node.getTotalDifficulty();
        if (td.gte(ann.td)) {
          // the remote peer is behind, ignore
          continue;
        }

        if (ann.td.sub(td).gten(snapSyncMinTD)) {
          logger.debug('Synchronizer::syncLoop, try to start a new snap sync');
          // we're about a week behind, try snap sync first
          const data = await this.downloadBlockDataFromAnn(ann);
          if (data === null) {
            // download data failed,
            // maybe we should ban the remote peer
            continue;
          }

          // sleep for a while to ensure
          // the block has been synced by other peers
          await this.delay.wait(waitingSyncDelay);
          if (this.aborted) {
            // exit if we have aborted
            break;
          }

          // download data from other nodes to verify the data
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

          // if we have collected enough confirmations, start snap sync
          if (confirmed >= 2) {
            logger.debug('Synchronizer::syncLoop, confirmed succeed');
            const info: SyncInfo = {
              bestHeight: new BN(ann.handler.status!.height),
              bestTD: ann.td,
              remotePeerId: ann.handler.peer.peerId
            };
            const startingBlock = this.node.latestBlock.header.number.toNumber();
            await this.snap.snapSync(data.block.header.stateRoot, startingBlock, info, async () => {
              logger.debug('Synchronizer::syncLoop, snapSync onFinished');
              // save block and receipts to database
              await this.node.commitBlock({
                ...data,
                broadcast: false,
                force: true,
                td: ann.td
              });
            });
          } else {
            logger.debug('Synchronizer::syncLoop, confirmed failed:', confirmed);
          }
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
      if (!this.full.isSyncing && !this.snap.isSyncing && this.channel.array.length === 0) {
        const td = this.node.getTotalDifficulty();
        const handlers = this.node.wire.pool.handlers.filter((handler) => new BN(handler.status!.totalDifficulty).gt(td));
        if (handlers.length === 0) {
          continue;
        }

        // randomly pick a peer to start sync
        this.announceNewBlock(handlers[getRandomIntInclusive(0, handlers.length - 1)]);
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
  announceNewPeer(handler: WireProtocolHandler) {
    this.channel.push({
      type: AnnouncementType.NewPeer,
      handler,
      height: new BN(handler.status!.height),
      td: new BN(handler.status!.totalDifficulty)
    });
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
      await this.syncLoopPromise;
      await this.randomPickLoopPromise;
    }
  }
}
