import EventEmitter from 'events';
import { BN } from 'ethereumjs-util';
import { BlockHeader } from '@rei-network/structure';
import { Database, DBSetBlockOrHeader, DBOp } from '@rei-network/database';
import { logger } from '@rei-network/utils';
import { preValidateHeader } from '../../validation';
import { HeaderSyncNetworkManager, HeaderSyncPeer } from './types';
const count: BN = new BN(256);

export interface HeaderSyncOptions {
  db: Database;
  network: HeaderSyncNetworkManager;
  maxGetBlockHeaders: BN;
  getRemotePeerInterval?: number;
}

export class HeaderSync extends EventEmitter {
  readonly db: Database;
  readonly network: HeaderSyncNetworkManager;

  private syncPromise: Promise<void> | undefined;
  private aborted: boolean = false;
  private maxGetBlockHeaders: BN;
  private getRemotePeerInterval: number;
  private readonly useless = new Set<HeaderSyncPeer>();

  constructor(options: HeaderSyncOptions) {
    super();
    this.db = options.db;
    this.network = options.network;
    this.maxGetBlockHeaders = options.maxGetBlockHeaders.clone();
    this.getRemotePeerInterval = options.getRemotePeerInterval || 2000;
  }

  async start(endHeader: BlockHeader) {
    this.syncPromise = new Promise(async (resolve) => {
      this.headerSync(endHeader, resolve).finally(() => {
        this.syncPromise = undefined;
      });
    });
  }

  private async headerSync(endHeader: BlockHeader, resolve: () => void) {
    const hash = await this.db.getHeadHeader();
    const number = await this.db.hashToNumber(hash);
    if (number.gte(endHeader.number)) {
      //emit synced
      return;
    }
    const end = endHeader.number.clone();
    const amount = end.sub(number);
    const total = amount.lt(count) ? amount : count; //@todo checkout is it greater than 0

    const handler = await this.getRemotePeer();
    if (!handler) {
      throw new Error('No remote nodes available');
    }
    const dbOps: DBOp[] = [];
    const queryCount = new BN(0);
    let child: BlockHeader = endHeader;

    while (!this.aborted && queryCount.lte(total)) {
      let count: BN;
      let start: BN;
      if (end.sub(this.maxGetBlockHeaders).gt(number)) {
        start = end.sub(this.maxGetBlockHeaders);
        count = this.maxGetBlockHeaders.clone();
      } else {
        start = number.clone();
        count = end.clone().sub(number);
      }
      try {
        const headers = await handler.getBlockHeaders(start, count);
        child = this.validateHeaders(child, headers);
        this.network.put(handler);
        if (!count.eqn(headers.length)) {
          throw new Error('useless');
        }
        headers.forEach((header) => {
          dbOps.concat(DBSetBlockOrHeader(header));
        });
        await this.db.batch(dbOps);
      } catch (err: any) {
        this.useless.add(handler);
        if (err.message !== 'useless') {
          //todo banPeer
        }
        return;
      }
      queryCount.iadd(count);
      end.isub(count);
    }
    this.emit('synced', endHeader.number.subn(1)); //target stateroot
    this.releaseUseless();
    resolve();
  }

  async reset(header: BlockHeader) {
    this.abort();
    await this.syncPromise;
    this.releaseUseless();
    this.aborted = false;
    this.start(header);
  }

  abort() {
    this.aborted = true;
  }

  private async getRemotePeer(time: number = 10) {
    let count = 0;
    let handler: HeaderSyncPeer | undefined;
    while (!this.aborted && count < time) {
      try {
        handler = await this.network.get();
      } catch (err) {
        logger.warn('HeaderSync::headerSync, get handler failed:', err);
      }
      await new Promise((resolve) => setInterval(resolve, this.getRemotePeerInterval));
      count++;
    }
    if (!handler) {
      throw new Error('HeaderSync::headerSync, no remote nodes available');
    }
    return handler;
  }

  private validateHeaders(child: BlockHeader, headers: BlockHeader[]) {
    for (let i = headers.length - 1; i >= 0; i--) {
      preValidateHeader.call(child, headers[i]);
      child = headers[i];
    }
    return child;
  }

  private releaseUseless() {
    this.useless.forEach((h) => {
      this.network.put(h);
    });
    this.useless.clear();
  }
}
