import EventEmitter from 'events';
import { logger } from '@rei-network/utils';
import { BlockHeader } from '@rei-network/structure';
import { DBSetBlockOrHeader, DBOp, DBSaveLookups } from '@rei-network/database';
import { Node } from '../../node';
import { blockNumber2TotalDifficulty } from '../../hardforks';
import { SyncInfo, BlockData } from '../types';
import { SnapSync } from './snapSync';
import { HeaderSync } from './headerSync';
import { preValidateHeader } from '../../validation';
import { WireProtocolHandler } from '../../protocols';
import { IHeaderSyncBackend, HeaderSyncPeer } from './types';

export declare interface SnapSyncScheduler {
  on(event: 'start', listener: (info: SyncInfo) => void): this;
  on(event: 'finished', listener: (info: SyncInfo) => void): this;
  on(event: 'synchronized', listener: (info: SyncInfo) => void): this;
  on(event: 'failed', listener: (info: SyncInfo) => void): this;

  off(event: 'start', listener: (info: SyncInfo) => void): this;
  off(event: 'finished', listener: (info: SyncInfo) => void): this;
  off(event: 'synchronized', listener: (info: SyncInfo) => void): this;
  off(event: 'failed', listener: (info: SyncInfo) => void): this;
}

export class SnapSyncScheduler extends EventEmitter {
  readonly node: Node;
  readonly snapSyncer: SnapSync;
  readonly headerSyncer: HeaderSync;

  private syncPromise?: Promise<void>;

  // sync state
  private startingBlock = 0;
  private highestBlock = 0;

  private listener = (preRoot: Buffer) =>
    this.snapSyncer.announcePreRoot(preRoot);

  constructor(node: Node) {
    super();
    this.node = node;
    this.snapSyncer = new SnapSync(this.node.db, this.node.snap.pool);
    this.headerSyncer = new HeaderSync({
      db: this.node.db,
      backend: new HeaderSyncBackend(node),
      pool: this.node.wire.pool
    });
    this.headerSyncer.on('preRoot', this.listener);
  }

  /**
   * Get the sync state
   */
  get status() {
    return {
      startingBlock: this.startingBlock,
      highestBlock: this.highestBlock
    };
  }

  /**
   * Is it syncing
   */
  get isSyncing() {
    return !!this.syncPromise;
  }

  // Generate snapshot and save block data
  private async saveBlockData(root: Buffer, data: BlockData) {
    try {
      // rebuild local snap
      const { generating } = await this.node.snapTree!.rebuild(root);
      // wait until generated
      await generating;
      // save block and receipts to database
      await this.node.commitBlock({
        ...data,
        broadcast: false,
        force: true,
        td: blockNumber2TotalDifficulty(
          data.block.header.number,
          data.block._common
        )
      });
    } catch (err) {
      logger.error('SnapSyncScheduler::saveBlockData, commit failed:', err);
    }
  }

  /**
   * Reset snap sync root and highest block number
   * @param root - New state root
   * @param startingBlock - Start sync block number
   * @param info - Sync info
   * @param data - Sync block data
   */
  async resetRoot(
    root: Buffer,
    startingBlock: number,
    info: SyncInfo,
    data: BlockData
  ) {
    if (
      this.snapSyncer.root !== undefined &&
      !this.snapSyncer.root.equals(root)
    ) {
      // abort
      await this.abort();
      // reset sync info
      this.startingBlock = startingBlock;
      this.highestBlock = info.bestHeight.toNumber();
      // start snap sync
      await this.snapSyncer.snapSync(root);
      // start header sync
      this.headerSyncer.headerSync(data.block.header);
      // wait until finished
      this.syncPromise = new Promise<void>(async (resolve) => {
        const [finished, headers] = await Promise.all([
          this.snapSyncer.wait(),
          this.headerSyncer.wait()
        ]);
        if (finished) {
          // save recent 256 headers
          await this.node.db.batch(
            headers.reduce((dbOps: DBOp[], header) => {
              dbOps.push(...DBSetBlockOrHeader(header));
              dbOps.push(...DBSaveLookups(header.hash(), header.number));
              return dbOps;
            }, [])
          );
          // save block data
          await this.saveBlockData(root, data);
          // send events
          this.emit('finished', info);
          this.emit('synchronized', info);
        }
        resolve();
        this.syncPromise = undefined;
        this.snapSyncer.clear();
      });
    }
  }

  /**
   * Async start snap sync,
   * this function will not wait until snap sync finished
   * @param root - State root
   * @param startingBlock - Start sync block number
   * @param info - Sync info
   * @param data - Sync block data
   */
  async snapSync(
    root: Buffer,
    startingBlock: number,
    info: SyncInfo,
    data: BlockData
  ) {
    if (this.isSyncing) {
      throw new Error('SnapSyncScheduler is working');
    }
    // save sync info
    this.startingBlock = startingBlock;
    this.highestBlock = info.bestHeight.toNumber();
    // send events
    this.emit('start', info);
    // start snap sync
    await this.snapSyncer.snapSync(root);
    // start header sync
    this.headerSyncer.headerSync(data.block.header);
    // wait until finished
    this.syncPromise = new Promise<void>(async (resolve) => {
      const [finished, headers] = await Promise.all([
        this.snapSyncer.wait(),
        this.headerSyncer.wait()
      ]);
      if (finished) {
        // save recent 256 headers
        await this.node.db.batch(
          headers.reduce((dbOps: DBOp[], header) => {
            dbOps.push(...DBSetBlockOrHeader(header));
            dbOps.push(...DBSaveLookups(header.hash(), header.number));
            return dbOps;
          }, [])
        );
        // save block data
        await this.saveBlockData(root, data);
        // send events
        this.emit('finished', info);
        this.emit('synchronized', info);
      }
      resolve();
      this.syncPromise = undefined;
      this.snapSyncer.clear();
    });
  }

  /**
   * Abort sync
   */
  async abort() {
    await this.snapSyncer.abort();
    await this.headerSyncer.abort();
    if (this.syncPromise) {
      await this.syncPromise;
    }
  }
}

class HeaderSyncBackend implements IHeaderSyncBackend {
  private node: Node;

  constructor(node: Node) {
    this.node = node;
  }

  async handlePeerError(prefix: string, peer: HeaderSyncPeer, err: any) {
    const peerId = (peer as WireProtocolHandler).peer.peerId;
    if (typeof err.message === 'string' && err.message.startsWith('timeout')) {
      logger.warn(prefix, 'peerId:', peerId, 'error:', err);
      await this.node.banPeer(peerId, 'timeout');
    } else if (err.message === 'abort') {
      // ignore abort error...
    } else {
      logger.error(prefix, 'peerId:', peerId, 'error:', err);
      await this.node.banPeer(peerId, 'invalid');
    }
  }

  validateHeaders(child: BlockHeader, headers: BlockHeader[]) {
    for (let i = headers.length - 1; i >= 0; i--) {
      preValidateHeader.call(child, headers[i]);
      child = headers[i];
    }
    return child;
  }
}
