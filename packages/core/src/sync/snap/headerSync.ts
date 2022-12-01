import EventEmitter from 'events';
import { BN } from 'ethereumjs-util';
import { BlockHeader } from '@rei-network/structure';
import { Database, DBSetBlockOrHeader, DBOp } from '@rei-network/database';
import { logger } from '@rei-network/utils';
import { HeaderSyncNetworkManager, HeaderSyncPeer, HeaderSyncBackend } from './types';
const count: BN = new BN(256);

export interface HeaderSyncOptions {
  db: Database;
  backend: HeaderSyncBackend;
  network: HeaderSyncNetworkManager;
  maxGetBlockHeaders: BN;
  getRemotePeerInterval?: number;
}

export class HeaderSync extends EventEmitter {
  readonly db: Database;
  readonly network: HeaderSyncNetworkManager;
  readonly headerSyncBackEnd: HeaderSyncBackend;

  private aborted: boolean = false;
  private maxGetBlockHeaders: BN;
  private getRemotePeerInterval: number;
  private useless = new Set<HeaderSyncPeer>();
  private syncPromise: Promise<void> | undefined;

  constructor(options: HeaderSyncOptions) {
    super();
    this.db = options.db;
    this.network = options.network;
    this.headerSyncBackEnd = options.backend;
    this.maxGetBlockHeaders = options.maxGetBlockHeaders.clone();
    this.getRemotePeerInterval = options.getRemotePeerInterval || 2000;
  }

  async start(endHeader: BlockHeader) {
    while (!this.aborted) {
      try {
        this.syncPromise = this.headerSync(endHeader);
        await this.syncPromise;
        this.syncPromise = undefined;
        break;
      } catch (err) {
        logger.warn('HeaderSync::start, header sync failed:', err);
      }
      await new Promise((resolve) => setInterval(resolve, 2000));
    }
    this.releaseUseless();
  }

  //reset start header
  async reset(header: BlockHeader) {
    this.abort();
    await this.syncPromise;
    this.releaseUseless();
    this.aborted = false;
    this.start(header);
  }

  //abort sync
  async abort() {
    this.aborted = true;
    await this.syncPromise;
    this.releaseUseless();
  }

  //header sync
  private async headerSync(endHeader: BlockHeader) {
    const hash = await this.db.getHeadHeader();
    const number = await this.db.hashToNumber(hash);
    //head header is higher than end header,get target header from db;
    if (number.gte(endHeader.number)) {
      const targetNumber = endHeader.number.subn(1);
      const hash = await this.db.numberToHash(targetNumber);
      const targetHeader = await this.db.getHeader(hash, targetNumber);
      this.emit('synced', targetHeader.stateRoot);
      return;
    }
    const end = endHeader.number.clone();
    const amount = end.sub(number);
    const total = amount.lt(count) ? amount : count;
    //get remote peer
    const handler = await this.getRemotePeer();
    if (!handler) {
      throw new Error('HeaderSync::download headers, get handler failed');
    }
    const queryCount = new BN(0);
    let child: BlockHeader = endHeader;
    //download headers
    while (!this.aborted && queryCount.lt(total)) {
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
        child = this.headerSyncBackEnd.validateHeaders(child, headers);
        this.network.put(handler);
        if (!count.eqn(headers.length)) {
          throw new Error('useless');
        }
        await this.saveHeaders(headers);
        const last = headers.pop();
        if (last?.number.eq(endHeader.number)) this.emit('synced', last.stateRoot);
      } catch (err: any) {
        this.useless.add(handler);
        if (err.message !== 'useless') {
          await this.headerSyncBackEnd.handlePeerError('HeaderSync::header sync', handler, err);
        }
        throw err;
      }
      queryCount.iadd(count);
      end.isub(count);
    }
  }

  //get remote peer
  private async getRemotePeer(time: number = 10) {
    let count = 0;
    let handler: HeaderSyncPeer | undefined;
    while (!this.aborted && count < time) {
      try {
        handler = await this.network.get();
      } catch (err) {
        logger.warn('HeaderSync::getRemotePeer, get handler failed:', err);
      }
      await new Promise((resolve) => setInterval(resolve, this.getRemotePeerInterval));
      count++;
    }
    return handler;
  }

  //save headers
  private async saveHeaders(headers: BlockHeader[]) {
    const dbOps: DBOp[] = [];
    headers.forEach((header) => {
      dbOps.concat(DBSetBlockOrHeader(header));
    });
    await this.db.batch(dbOps);
  }

  //release useless peer
  private releaseUseless() {
    this.useless.forEach((h) => {
      this.network.put(h);
    });
    this.useless.clear();
  }
}
