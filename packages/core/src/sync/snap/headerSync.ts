import EventEmitter from 'events';
import { BN } from 'ethereumjs-util';
import { BlockHeader } from '@rei-network/structure';
import { Database, DBSetBlockOrHeader, DBOp, DBSaveLookups } from '@rei-network/database';
import { logger, AbortableTimer } from '@rei-network/utils';
import { HeaderSyncNetworkManager, HeaderSyncPeer, HeaderSyncBackend } from './types';

const count: BN = new BN(256);
const maxGetBlockHeaders: BN = new BN(128);
const defaultRetryInterval = 1000;
const defaultGetHandlerTimeout = 3000;

export interface HeaderSyncOptions {
  db: Database;
  backend: HeaderSyncBackend;
  pool: HeaderSyncNetworkManager;
  throwError?: boolean;
  retryInterval?: number;
  getHandlerTimeout?: number;
}

export declare interface HeaderSync {
  on(event: 'preRoot', listener: (preRoot: Buffer) => void): this;

  off(event: 'preRoot', listener: (preRoot: Buffer) => void): this;
}

export class HeaderSync extends EventEmitter {
  readonly db: Database;
  readonly pool: HeaderSyncNetworkManager;
  readonly backend: HeaderSyncBackend;

  private aborted: boolean = false;
  private useless = new Set<HeaderSyncPeer>();
  private syncPromise: Promise<void> | undefined;
  private throwError: boolean;
  private retry = new AbortableTimer();
  private retryInterval: number;
  private getHandlerTimeout: number;

  constructor(options: HeaderSyncOptions) {
    super();
    this.db = options.db;
    this.pool = options.pool;
    this.backend = options.backend;
    this.throwError = options.throwError ?? false;
    this.retryInterval = options.retryInterval ?? defaultRetryInterval;
    this.getHandlerTimeout = options.getHandlerTimeout ?? defaultGetHandlerTimeout;
  }

  /**
   * Start header sync
   * @param header - end header
   * @returns sync promise
   */
  headerSync(header: BlockHeader) {
    if (this.syncPromise) {
      throw new Error('Header sync is already running');
    }
    this.aborted = false;
    this.syncPromise = this.doSync(header)
      .catch((err) => {
        logger.error('HeaderSync::headerSync, catch error:', err);
        if (this.throwError) {
          throw err;
        }
      })
      .finally(() => {
        this.syncPromise = undefined;
        this.useless.forEach((h) => {
          this.pool.put(h);
        });
        this.useless.clear();
      });
  }

  /**
   * Wait until header sync finished
   */
  async wait() {
    if (this.syncPromise) {
      await this.syncPromise;
    }
  }

  /**
   * Abort header sync
   */
  async abort() {
    this.aborted = true;
    this.retry.abort();
    await this.syncPromise;
  }

  /**
   * Download the 256 block headers before the specified block header
   * @param header - specified end block header
   */
  private async doSync(header: BlockHeader) {
    const endNumbr = header.number.clone();
    const needDownload: BN[] = [];
    for (let i = new BN(1); i.lte(count); i.iaddn(1)) {
      const n = endNumbr.sub(i);
      if (n.lten(0)) {
        break;
      }
      try {
        const hash = await this.db.numberToHash(n);
        if (i.eqn(1)) {
          const targetHeader = await this.db.getHeader(hash, n);
          this.emit('preRoot', targetHeader.stateRoot);
        }
      } catch (err: any) {
        if (err.type === 'NotFoundError') {
          needDownload.push(n);
          continue;
        }
        throw err;
      }
    }
    if (needDownload.length === 0) {
      return;
    }
    const last = needDownload[0];
    const first = needDownload[needDownload.length - 1];
    const amount = last.sub(first).addn(1);
    const queryCount = new BN(0);
    const target = header.number.subn(1);
    let child: BlockHeader = header;
    while (!this.aborted && queryCount.lt(amount)) {
      let count: BN;
      let start: BN;
      let left = amount.sub(queryCount);
      if (left.gt(maxGetBlockHeaders)) {
        start = last.sub(maxGetBlockHeaders).addn(1);
        count = maxGetBlockHeaders.clone();
      } else {
        start = first.clone();
        count = left.clone();
      }
      child = await this.downloadHeaders(child, start, count, target);
      queryCount.iadd(count);
      last.isub(count);
    }
  }

  /**
   * Download block headers and save them to the database
   * @param child - child block header to validate headers
   * @param start - start block number to download
   * @param count - block header count to download
   * @param target - target block number to announce
   * @param retryLimit - retry download limit
   * @returns child block header
   */
  private async downloadHeaders(child: BlockHeader, start: BN, count: BN, target: BN, retryLimit: number = 10) {
    let times = 0;
    const retry = async () => {
      if (times++ > retryLimit) {
        throw new Error('reach retry limit');
      }
      await this.retry.wait(this.retryInterval);
    };
    while (!this.aborted) {
      // 1. get handler
      let handler: HeaderSyncPeer;
      try {
        handler = await this.pool.get(this.getHandlerTimeout);
      } catch (err: any) {
        logger.warn('HeaderSync::downloadHeaders, get handler failed:', err);
        await retry();
        continue;
      }

      // 2. download headers
      let headers: BlockHeader[];
      try {
        headers = await handler.getBlockHeaders(start, count);
        child = this.backend.validateHeaders(child, headers);
        if (!count.eqn(headers.length)) {
          throw new Error('useless');
        }
        this.pool.put(handler);
      } catch (err: any) {
        this.useless.add(handler);
        if (err.message !== 'useless') {
          await this.backend.handlePeerError('HeaderSync::downloadHeaders', handler!, err);
        }
        await retry();
        continue;
      }

      // 3. try to emit event
      const last = headers[headers.length - 1];
      if (last.number.eq(target)) {
        this.emit('preRoot', last.stateRoot);
      }

      // 4. save headers
      await this.db.batch(
        headers.reduce((dbOps: DBOp[], header) => {
          dbOps.push(...DBSetBlockOrHeader(header));
          dbOps.push(...DBSaveLookups(header.hash(), header.number));
          return dbOps;
        }, [])
      );
      break;
    }
    return child;
  }
}
