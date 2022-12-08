import EventEmitter from 'events';
import { BN } from 'ethereumjs-util';
import { BlockHeader } from '@rei-network/structure';
import { Database, DBSetBlockOrHeader, DBOp, DBSaveLookups } from '@rei-network/database';
import { logger } from '@rei-network/utils';
import { HeaderSyncNetworkManager, HeaderSyncPeer, IHeaderSyncBackend } from './types';
const count: BN = new BN(256);

export interface HeaderSyncOptions {
  db: Database;
  backend: IHeaderSyncBackend;
  wireHandlerPool: HeaderSyncNetworkManager;
  downloadHeadersInterval?: number;
  testMode?: boolean;
}

export class HeaderSync extends EventEmitter {
  readonly db: Database;
  readonly wireHandlerPool: HeaderSyncNetworkManager;
  readonly headerSyncBackEnd: IHeaderSyncBackend;

  private aborted: boolean = false;
  private maxGetBlockHeaders: BN = new BN(128);
  private downloadHeadersInterval: number;
  private useless = new Set<HeaderSyncPeer>();
  private syncPromise: Promise<void> | undefined;
  private readonly testMode: boolean;

  constructor(options: HeaderSyncOptions) {
    super();
    this.db = options.db;
    this.wireHandlerPool = options.wireHandlerPool;
    this.headerSyncBackEnd = options.backend;
    this.downloadHeadersInterval = options.downloadHeadersInterval || 2000;
    this.testMode = options.testMode || false;
  }

  /**
   * Start header sync
   * @param endHeader - end header
   * @returns sync promise
   */
  startSync(endHeader: BlockHeader) {
    if (this.syncPromise) {
      throw new Error('HeaderSync::start sync already running');
    }
    return (this.syncPromise = this.headerSync(endHeader).finally(() => {
      this.syncPromise = undefined;
      this.useless.forEach((h) => {
        this.wireHandlerPool.put(h);
      });
      this.useless.clear();
    }));
  }

  /**
   * Reset header sync
   * @param header - end header
   * @returns sync promise
   */
  async reset(header: BlockHeader) {
    await this.abort();
    this.aborted = false;
    return this.startSync(header);
  }

  /**
   * Abort header sync
   */
  async abort() {
    this.aborted = true;
    await this.syncPromise;
  }

  /**
   * Download the 256 block headers before the specified block header
   * @param endHeader - specified end block header
   */
  private async headerSync(endHeader: BlockHeader) {
    const endNumbr = endHeader.number.clone();
    const needDownload: BN[] = [];
    for (let i = new BN(1); i.lte(count); i.iaddn(1)) {
      const n = endNumbr.sub(i);
      if (n.ltn(0)) {
        break;
      }
      try {
        const hash = await this.db.numberToHash(n);
        if (i.eqn(1)) {
          const targetHeader = await this.db.getHeader(hash, n);
          this.emit('synced', targetHeader.stateRoot);
        }
      } catch (error) {
        if ((error as any).type === 'NotFoundError') {
          needDownload.push(n);
          continue;
        } else {
          throw error;
        }
      }
    }
    if (needDownload.length === 0) {
      return;
    }
    const last = needDownload[0];
    const first = needDownload[needDownload.length - 1];
    const amount = last.sub(first).addn(1);
    const queryCount = new BN(0);
    const target = endHeader.number.subn(1);
    let child: BlockHeader = endHeader;

    while (!this.aborted && queryCount.lt(amount)) {
      let count: BN;
      let start: BN;
      let left = amount.sub(queryCount);
      if (left.gt(this.maxGetBlockHeaders)) {
        start = last.sub(this.maxGetBlockHeaders).addn(1);
        count = this.maxGetBlockHeaders.clone();
      } else {
        start = first.clone();
        count = left.clone();
      }
      try {
        child = await this.downloadHeaders(child, start, count, target);
        queryCount.iadd(count);
        last.isub(count);
      } catch (err) {
        if (!this.testMode) {
          logger.warn('HeaderSync::headerSync fail: ', err);
          break;
        }
        throw err;
      }
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
    let time = 0;
    while (!this.aborted) {
      let handler: HeaderSyncPeer | undefined;
      try {
        handler = await this.wireHandlerPool.get();
        const headers = await handler.getBlockHeaders(start, count);
        child = this.headerSyncBackEnd.validateHeaders(child, headers);
        if (!count.eqn(headers.length)) {
          throw new Error('useless');
        }
        await this.saveHeaders(headers);
        this.wireHandlerPool.put(handler);
        const last = headers.pop();
        if (last?.number.eq(target)) {
          this.emit('synced', last.stateRoot);
        }
        break;
      } catch (err: any) {
        if (handler === undefined) {
          logger.warn('HeaderSync::downloadHeaders, get handler failed: ', err);
        } else {
          this.useless.add(handler);
          if (err.message !== 'useless') {
            await this.headerSyncBackEnd.handlePeerError('HeaderSync::downloadHeaders', handler!, err);
          }
        }
        if (time >= retryLimit) {
          throw err;
        }
      }
      time++;
      await new Promise((resolve) => setTimeout(resolve, this.downloadHeadersInterval));
    }
    return child;
  }

  /**
   * Save block headers to the database
   * @param headers - block headers
   */
  private async saveHeaders(headers: BlockHeader[]) {
    const dbOps: DBOp[] = [];
    headers.forEach((header) => {
      dbOps.push(...DBSetBlockOrHeader(header));
      dbOps.push(...DBSaveLookups(header.hash(), header.number));
    });
    await this.db.batch(dbOps);
  }
}
