import { EventEmitter } from 'events';
import Semaphore from 'semaphore-async-await';
import { BN, KECCAK256_RLP } from 'ethereumjs-util';
import { logger, AbortableTimer } from '@rei-network/utils';
import { BlockHeader, Transaction, Block } from '@rei-network/structure';
import { Node } from '../../node';
import { Fetcher } from './fetcher';
import { preValidateBlock, preValidateHeader } from '../../validation';
import { WireProtocolHandler, maxGetBlockHeaders } from '../../protocols';

const defaultDownloadElementsCountLimit = new BN(maxGetBlockHeaders);
const defaultSyncInterval = 1000;
const defaultMinSyncPeers = 3;

export interface SynchronizerOptions {
  node: Node;
  interval?: number;
  minSyncPeers?: number;
  elementsCountLimit?: BN;
}

export declare interface Synchronizer {
  on(event: 'start', listener: () => void): this;
  on(event: 'synchronized', listener: () => void): this;
  on(event: 'failed', listener: () => void): this;

  off(event: 'start', listener: () => void): this;
  off(event: 'synchronized', listener: () => void): this;
  off(event: 'failed', listener: () => void): this;
}

export class Synchronizer extends EventEmitter {
  private readonly node: Node;
  private readonly interval: number;
  private readonly minSyncPeers: number;
  private readonly elementsCountLimit: BN;
  private readonly lock = new Semaphore(1);
  private readonly fetcher: Fetcher;
  private readonly timer = new AbortableTimer();

  private forceSync: boolean = false;
  private aborted: boolean = false;

  private syncLoopPromise?: Promise<void>;
  private localHeader?: BlockHeader;
  private startingBlock: number = 0;
  private highestBlock: number = 0;

  constructor(options: SynchronizerOptions) {
    super();
    this.node = options.node;
    this.interval = options.interval ?? defaultSyncInterval;
    this.minSyncPeers = options.minSyncPeers ?? defaultMinSyncPeers;
    this.elementsCountLimit = options.elementsCountLimit ?? defaultDownloadElementsCountLimit;
    this.fetcher = new Fetcher({ backend: this, validateBackend: this, common: this.node.getCommon(0), downloadElementsCountLimit: this.elementsCountLimit });
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
    return this.lock.getPermits() === 0;
  }

  private async runWithLock<T>(fn: () => Promise<T>) {
    try {
      await this.lock.acquire();
      return await fn();
    } finally {
      this.lock.release();
    }
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

      const count = latest.gt(this.elementsCountLimit) ? this.elementsCountLimit.clone() : latest.clone();
      latest.isub(count.subn(1));

      let headers!: BlockHeader[];
      try {
        headers = await handler.getBlockHeaders(latest, count);
      } catch (err: any) {
        await this.handlePeerError('Synchronizer::findAncient', handler.peer.peerId, err);
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
          logger.error('Synchronizer::findAncient, load header failed:', err);
        }
      }
    }
  }

  private findTarget(handler?: WireProtocolHandler) {
    const wire = this.node.wire;
    if (!this.forceSync && wire.pool.handlers.length < this.minSyncPeers) {
      // if we don’t get enough remote peers, return
      return;
    }

    let bestPeerHandler: WireProtocolHandler | undefined;
    let bestHeight!: BN;
    let bestTD!: BN;

    if (handler) {
      // if handler exists,
      // read information from handler
      bestPeerHandler = handler;
      bestHeight = new BN(bestPeerHandler.status!.height);
      bestTD = new BN(bestPeerHandler.status!.totalDifficulty);
      if (bestTD.lte(this.node.getTotalDifficulty())) {
        logger.debug('Synchronizer::findTarget, best TD less or equal than local TD');
        return;
      }
    } else {
      // if handler doesn't exist,
      // randomly select one from the handler pool
      bestTD = this.node.getTotalDifficulty();
      for (const handler of wire.pool.handlers) {
        const remoteStatus = handler.status!;
        const td = new BN(remoteStatus.totalDifficulty);
        if (td.gt(bestTD)) {
          bestPeerHandler = handler;
          bestHeight = new BN(remoteStatus.height);
          bestTD = td;
        }
      }
      if (!bestPeerHandler) {
        logger.debug('Synchronizer::findTarget, can not find best peer handler, pool size:', wire.pool.handlers.length);
        return;
      }
    }

    return {
      bestPeerHandler,
      bestHeight,
      bestTD
    };
  }

  private syncOnce(handler?: WireProtocolHandler) {
    return this.runWithLock(async () => {
      const target = this.findTarget(handler);
      if (!target) {
        // the target peer has been disconneted or
        // we don't have the best peer
        return;
      }

      const { bestPeerHandler, bestHeight, bestTD } = target;

      // find common ancient
      const result = await this.findAncient(bestPeerHandler);
      if (!result) {
        return;
      }

      const localHeader = result.header;
      const localTD = result.td;
      if (localHeader.number.eq(bestHeight)) {
        // we already have this best block
        logger.debug('Synchronizer::syncOnce, we already have this best block');
        return;
      }

      // add check for reimint consensus engine
      const reimint = this.node.reimint;
      if (reimint.isStarted && reimint.state.hasMaj23Precommit(bestHeight)) {
        // our consensus engine has collected enough votes for this height,
        // so we ignore this best block
        logger.debug('Synchronizer::syncOnce, we collected enough votes for this height');
        return;
      }

      const peerId = bestPeerHandler.peer.peerId;
      logger.info('💡 Get best height from:', peerId, 'best height:', bestHeight.toString(), 'local height:', localHeader.number.toString());
      this.startingBlock = localHeader.number.toNumber();
      this.highestBlock = bestHeight.toNumber();
      this.emit('start');

      // record local header information
      this.localHeader = localHeader;
      const start = localHeader.number.addn(1);
      const totalCount = new BN(bestHeight).sub(localHeader.number);

      // start fetch
      this.fetcher.reset();
      const { reorged, cumulativeTotalDifficulty } = await this.fetcher.fetch(start, totalCount, bestPeerHandler);

      // check total difficulty
      if (!cumulativeTotalDifficulty.add(localTD).eq(bestTD)) {
        // await this.node.banPeer(peerId, 'invalid');
        logger.warn('Synchronizer::syncOnce, total difficulty does not match:', peerId);
      }

      const latest = this.node.getLatestBlock();
      const td = this.node.getTotalDifficulty();
      logger.info('💫 Sync over, local height:', latest.header.number.toString(), 'local td:', this.node.getTotalDifficulty().toString(), 'best height:', bestHeight.toString(), 'best td:', bestTD.toString());
      if (reorged) {
        logger.info('💫 Synchronized');
        this.emit('synchronized');
        this.node.wire.broadcastNewBlock(latest, td);
      } else {
        this.emit('failed');
      }
    });
  }

  /**
   * Start the Synchronizer
   */
  private async syncLoop() {
    while (!this.aborted) {
      if (!this.isSyncing) {
        await this.syncOnce();
      }
      await this.timer.wait(this.interval);
    }
  }

  /**
   * Announce to Synchronizer
   * @param handler - Handler
   */
  announce(handler: WireProtocolHandler) {
    if (!this.isSyncing) {
      this.syncOnce(handler);
    }
  }

  /**
   * Start sync
   */
  start() {
    if (this.syncLoopPromise) {
      throw new Error('repeated start');
    }

    this.syncLoopPromise = this.syncLoop();
    setTimeout(() => {
      this.forceSync = true;
    }, this.interval * 30);
  }

  /**
   * Abort sync
   */
  async abort() {
    if (this.syncLoopPromise) {
      this.aborted = true;
      await this.fetcher.abort();
      this.timer.abort();
      await this.syncLoopPromise;
      this.syncLoopPromise = undefined;
    }
  }

  /////////////////// Fetcher backend ///////////////////

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
   * @returns
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

  /////////////////// Fetcher backend ///////////////////
}
