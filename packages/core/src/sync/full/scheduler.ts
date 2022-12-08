import EventEmitter from 'events';
import { BN, KECCAK256_RLP } from 'ethereumjs-util';
import { logger } from '@rei-network/utils';
import { BlockHeader, Transaction, Block } from '@rei-network/structure';
import { Node } from '../../node';
import { preValidateBlock, preValidateHeader } from '../../validation';
import { WireProtocolHandler, maxGetBlockHeaders } from '../../protocols';
import { SyncInfo } from '../types';
import { BlockSync, BlockSyncBackend as IBlockSyncBackend, BlockSyncValidateBackend as IBlockSyncValidateBackend } from './blockSync';

const bnMaxGetBlockHeaders = new BN(maxGetBlockHeaders);

class BlockSyncBackend implements IBlockSyncBackend, IBlockSyncValidateBackend {
  private node: Node;
  private localHeader!: BlockHeader;

  constructor(node: Node) {
    this.node = node;
  }

  /**
   * Reset local header,
   * local header will be used for validateHeaders
   * @param localHeader - Header
   */
  resetLocalHeader(localHeader: BlockHeader) {
    this.localHeader = localHeader;
  }

  /**
   * Handle peer error,
   * ban peer when request timeout or invalid,
   * ignore abort error
   * @param prefix - Log prefix
   * @param peerId - Peer id
   * @param err - Error
   */
  async handlePeerError(prefix: string, peerId: string, err: any) {
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

  /**
   * Process block and commit it to db
   * @param block - Block
   * @returns Reorg
   */
  async processAndCommitBlock(block: Block) {
    try {
      const result = await this.node.getExecutor(block._common).processBlock({ block });
      return await this.node.commitBlock({
        ...result,
        block,
        broadcast: false
      });
    } catch (err: any) {
      if (err.message === 'committed' || err.message === 'aborted') {
        return false;
      } else {
        throw err;
      }
    }
  }

  /**
   * Validate headers
   * @param parent - Parent block header(if it exsits)
   * @param headers - A list of headers that need to be validated
   * @returns Latest header
   */
  validateHeaders(parent: BlockHeader | undefined, headers: BlockHeader[]) {
    headers.forEach((header, i) => {
      preValidateHeader.call(header, i === 0 ? parent ?? this.localHeader! : headers[i - 1]);
    });
    return headers[headers.length - 1];
  }

  /**
   * Validate block bodies
   * @param headers - A list of headers
   * @param bodies - A list of bodies, one-to-one correspondence with headers
   */
  validateBodies(headers: BlockHeader[], bodies: Transaction[][]) {
    if (headers.length !== bodies.length) {
      throw new Error('invalid bodies length');
    }
    headers.forEach((header, i) => {
      if (bodies[i].length === 0 && !header.transactionsTrie.equals(KECCAK256_RLP)) {
        throw new Error('useless');
      }
    });
  }

  /**
   * Validate blocks
   * @param blocks - A list of blocks that need to be validated
   */
  async validateBlocks(blocks: Block[]) {
    await Promise.all(blocks.map((b) => preValidateBlock.call(b)));
  }
}

export declare interface FullSyncScheduler {
  on(event: 'start', listener: (info: SyncInfo) => void): this;
  on(event: 'finished', listener: (info: SyncInfo) => void): this;
  on(event: 'synchronized', listener: (info: SyncInfo) => void): this;
  on(event: 'failed', listener: (info: SyncInfo) => void): this;

  off(event: 'start', listener: (info: SyncInfo) => void): this;
  off(event: 'finished', listener: (info: SyncInfo) => void): this;
  off(event: 'synchronized', listener: (info: SyncInfo) => void): this;
  off(event: 'failed', listener: (info: SyncInfo) => void): this;
}

export class FullSyncScheduler extends EventEmitter {
  private readonly node: Node;
  private readonly backend: BlockSyncBackend;
  private readonly blockSync: BlockSync;

  private syncPromise?: Promise<void>;

  // sync state
  private startingBlock: number = 0;
  private highestBlock: number = 0;

  constructor(node: Node) {
    super();
    this.node = node;
    this.backend = new BlockSyncBackend(node);
    this.blockSync = new BlockSync({
      backend: this.backend,
      validateBackend: this.backend,
      common: this.node.getCommon(0),
      maxGetBlockHeaders: bnMaxGetBlockHeaders
    });
  }

  /**
   * Get the sync state
   */
  get status() {
    return { startingBlock: this.startingBlock, highestBlock: this.highestBlock };
  }

  /**
   * Is it syncing
   */
  get isSyncing() {
    return !!this.syncPromise;
  }

  private async genesis(): Promise<{ header: BlockHeader; td: BN }> {
    const { header } = await this.node.db.getBlock(0);
    return { header, td: header.difficulty };
  }

  // TODO: binary search.
  private async findAncient(handler: WireProtocolHandler): Promise<{ header: BlockHeader; td: BN } | undefined> {
    const latest = this.node.getLatestBlock().header.number.clone();
    if (latest.eqn(0)) {
      return await this.genesis();
    }

    while (latest.gtn(0)) {
      if (latest.eqn(1)) {
        return await this.genesis();
      }

      const count = latest.gt(bnMaxGetBlockHeaders) ? bnMaxGetBlockHeaders.clone() : latest.clone();
      latest.isub(count.subn(1));

      let headers!: BlockHeader[];
      try {
        headers = await handler.getBlockHeaders(latest, count);
      } catch (err: any) {
        // maybe we should ban the remote peer
        return;
      }

      // remote peer lost some headers, break
      if (headers.length === 0) {
        return;
      }

      for (let i = headers.length - 1; i >= 0; i--) {
        try {
          const remoteHeader = headers[i];
          const hash = remoteHeader.hash();
          const header = await this.node.db.getHeader(hash, remoteHeader.number);
          const td = await this.node.db.getTotalDifficulty(hash, remoteHeader.number);
          return { header, td };
        } catch (err: any) {
          if (err.type === 'NotFoundError') {
            continue;
          }
          logger.error('FullSync::findAncient, load header failed:', err);
        }
      }
    }
  }

  private async syncOnce(handler: WireProtocolHandler) {
    const bestHeight = new BN(handler.status!.height);
    const bestTD = new BN(handler.status!.totalDifficulty);

    // find common ancient
    const result = await this.findAncient(handler);
    if (!result) {
      return;
    }

    const localHeader = result.header;
    const localTD = result.td;
    if (localHeader.number.eq(bestHeight)) {
      // we already have this best block
      logger.debug('FullSync::syncOnce, we already have this best block');
      return;
    }

    // add check for reimint consensus engine
    const reimint = this.node.reimint;
    if (reimint.isStarted && reimint.state.hasMaj23Precommit(bestHeight)) {
      // our consensus engine has collected enough votes for this height,
      // so we ignore this best block
      logger.debug('FullSync::syncOnce, we collected enough votes for this height');
      return;
    }

    const peerId = handler.peer.peerId;
    const info: SyncInfo = {
      bestHeight,
      bestTD,
      remotePeerId: peerId
    };

    this.startingBlock = localHeader.number.toNumber();
    this.highestBlock = bestHeight.toNumber();
    this.emit('start', info);

    // save local header information
    const start = localHeader.number.addn(1);
    const totalCount = bestHeight.sub(localHeader.number);
    this.backend.resetLocalHeader(localHeader);

    // start block sync
    this.blockSync.reset();
    const { reorged, cumulativeTotalDifficulty } = await this.blockSync.fetch(start, totalCount, handler);

    // check total difficulty
    if (!cumulativeTotalDifficulty.add(localTD).eq(bestTD)) {
      // maybe we should ban the remote peer?
      // await this.node.banPeer(peerId, 'invalid');
      logger.warn('FullSync::syncOnce, total difficulty does not match:', peerId);
    }

    // send events
    this.emit('finished', info);
    if (reorged) {
      this.emit('synchronized', info);
    } else {
      this.emit('failed', info);
    }
  }

  /**
   * Start full sync
   * @param handler - Handler instance
   */
  fullSync(handler: WireProtocolHandler) {
    if (this.syncPromise) {
      throw new Error('full sync is working');
    }

    this.syncPromise = this.syncOnce(handler)
      .catch((err) => {
        logger.error('FullSync::fullSync, catch:', err);
      })
      .finally(() => {
        this.syncPromise = undefined;
      });
  }

  /**
   * Abort sync
   */
  async abort() {
    if (this.syncPromise) {
      await this.blockSync.abort();
      await this.syncPromise;
    }
  }
}
