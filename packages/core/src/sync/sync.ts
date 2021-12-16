import { EventEmitter } from 'events';
import Semaphore from 'semaphore-async-await';
import { BN, KECCAK256_RLP } from 'ethereumjs-util';
import { logger } from '@rei-network/utils';
import { BlockHeader, Transaction, Block } from '@rei-network/structure';
import { Node } from '../node';
import { Fetcher } from './fetcher';
import { preValidateBlock, preValidateHeader } from '../validation';
import { WireProtocolHandler, PeerRequestTimeoutError, maxGetBlockHeaders } from '../protocols';

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

  private syncLoopPromise?: Promise<void>;
  private localHeader?: BlockHeader;
  private startingBlock: number = 0;
  private highestBlock: number = 0;
  private forceSync: boolean = false;

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
    } catch (err) {
      throw err;
    } finally {
      this.lock.release();
    }
  }

  private async genesis(): Promise<[BlockHeader, BN]> {
    const { header } = await this.node.db.getBlock(0);
    return [header, header.difficulty];
  }

  // TODO: binary search.
  private async findAncient(handler: WireProtocolHandler): Promise<[BlockHeader, BN]> {
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
          return [localHeader, localTD];
        } catch (err: any) {
          if (err.type === 'NotFoundError') {
            continue;
          }
          throw err;
        }
      }
    }
    throw new Error('find acient failed');
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
      const [localHeader, localTD] = await this.findAncient(bestPeerHandler);
      if (localHeader.number.eq(bestHeight)) {
        // we already have this best block
        return;
      }

      // add check for reimint consensus engine
      const reimint = this.node.reimint;
      if (reimint.isStarted && reimint.state.hasMaj23Precommit(bestHeight)) {
        // our consensus engine has collected enough votes for this height,
        // so we ignore this best block
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
        await this.node.banPeer(peerId, 'invalid');
        logger.warn('Synchronizer::doSync, total difficulty does not match:', peerId);
      }

      const latest = this.node.getLatestBlock();
      logger.info('💫 Sync over, local height:', latest.header.number.toString(), 'local td:', this.node.getTotalDifficulty().toString(), 'best height:', bestHeight.toString(), 'best td:', bestTD.toString());
      if (reorged) {
        logger.info('💫 Synchronized');
        this.emit('synchronized');
        this.node.wire.broadcastNewBlock(latest);
      } else {
        this.emit('failed');
      }
    });
  }

  /**
   * Start the Synchronizer
   */
  private async syncLoop() {
    while (!this.node.aborter.isAborted) {
      if (!this.isSyncing) {
        await this.syncOnce();
      }
      await this.node.aborter.abortablePromise(new Promise((r) => setTimeout(r, this.interval)));
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
      this.fetcher.abort();
      await this.syncLoopPromise;
      this.syncLoopPromise = undefined;
    }
  }

  /////////////////// Fetcher backend ///////////////////

  banPeer(peerId: string, reason: string) {
    return this.node.banPeer(peerId, reason as any);
  }

  async processAndCommitBlock(block: Block) {
    const result = await this.node.getExecutor(block._common).processBlock({ block });
    return await this.node.commitBlock({
      ...result,
      block,
      broadcast: false
    });
  }

  validateHeaders(parent: BlockHeader | undefined, headers: BlockHeader[]) {
    headers.forEach((header, i) => {
      preValidateHeader.call(header, i === 0 ? parent ?? this.localHeader! : headers[i - 1]);
    });
    return headers[headers.length - 1];
  }

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

  async validateBlocks(blocks: Block[]) {
    await Promise.all(blocks.map((b) => preValidateBlock.call(b)));
  }

  /////////////////// Fetcher backend ///////////////////
}
