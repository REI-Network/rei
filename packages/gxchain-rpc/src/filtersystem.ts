import { Address, BN } from 'ethereumjs-util';
import { uuidv4 } from 'uuid';
import { Aborter } from '@gxchain2/utils';
import { Log } from '@gxchain2/receipt';
import { Topics, BloomBitsFilter } from '@gxchain2/core/dist/bloombits';
import { WsClient, SyncingStatus } from './client';

export type FilterQuery = {
  type: string;
  fromBlock: BN;
  toBlock: BN;
  addresses: Address[];
  topics: Topics;
};

const deadline = 5 * 60 * 1000;

type FilterInfo = {
  createtime: number;
  hashes: Buffer[];
  logs: Log[];
  queryInfo: FilterQuery;
  client?: WsClient;
};

export class FilterSystem {
  private aborter = new Aborter();

  private readonly wsHeads = new Map<string, FilterInfo>();
  private readonly wsLogs = new Map<string, FilterInfo>();
  private readonly wsPendingTransactions = new Map<string, FilterInfo>();
  private readonly wsSyncing = new Map<string, FilterInfo>();
  private readonly httpHeads = new Map<string, FilterInfo>();
  private readonly httpLogs = new Map<string, FilterInfo>();
  private readonly httpPendingTransactions = new Map<string, FilterInfo>();

  constructor() {
    this.timeoutLoop();
  }

  private cycleDelete(map: Map<string, FilterInfo>) {
    const timenow = Date.now();
    for (const [key, filter] of map) {
      if (timenow - filter.createtime > deadline) {
        map.delete(key);
      }
    }
  }

  async abort() {
    await this.aborter.abort();
  }

  private async timeoutLoop() {
    while (!this.aborter.isAborted) {
      await this.aborter.abortablePromise(new Promise((r) => setTimeout(r, deadline)));
      if (this.aborter.isAborted) {
        break;
      }
      this.cycleDelete(this.httpHeads);
      this.cycleDelete(this.httpLogs);
      this.cycleDelete(this.httpPendingTransactions);
    }
  }

  wsSubscibe(client: WsClient, queryInfo: FilterQuery): string {
    const uid = uuidv4();
    const filterInstance = { createtime: Date.now(), hashes: [], logs: [], queryInfo, client };
    switch (queryInfo.type) {
      case 'newHeads': {
        this.wsHeads.set(uid, filterInstance);
        break;
      }
      case 'logs': {
        this.wsLogs.set(uid, filterInstance);
        break;
      }
      case 'newPendingTransactions': {
        this.wsPendingTransactions.set(uid, filterInstance);
        break;
      }
      case 'syncing': {
        this.wsSyncing.set(uid, filterInstance);
        break;
      }
    }
    return uid;
  }

  httpSubscribe(queryInfo: FilterQuery): string {
    const uid = uuidv4();
    const filterInstance = { createtime: Date.now(), hashes: [], logs: [], queryInfo };
    switch (queryInfo.type) {
      case 'newHeads': {
        this.httpHeads.set(uid, filterInstance);
        break;
      }
      case 'logs': {
        this.httpLogs.set(uid, filterInstance);
        break;
      }
      case 'newPendingTransactions': {
        this.httpPendingTransactions.set(uid, filterInstance);
        break;
      }
    }
    return uid;
  }

  wsUnsubscribe(id: string) {
    this.wsHeads.delete(id);
    this.wsLogs.delete(id);
    this.wsPendingTransactions.delete(id);
    this.wsSyncing.delete(id);
  }

  httpUnsubscribe(id: string) {
    this.httpHeads.delete(id);
    this.httpLogs.delete(id);
    this.httpPendingTransactions.delete(id);
  }

  private changed(id: string, map: Map<string, FilterInfo>, logorhash: boolean) {
    const filterInfo = map.get(id);
    if (!filterInfo) {
      return;
    }
    if (logorhash) {
      const info = filterInfo.logs;
      filterInfo.logs = [];
      return info;
    } else {
      const info = filterInfo?.hashes;
      filterInfo.hashes = [];
      return info;
    }
  }

  httpFilterChanged(id: string, type: string) {
    switch (type) {
      case 'newHeads': {
        return this.changed(id, this.httpHeads, false);
      }
      case 'logs': {
        return this.changed(id, this.httpLogs, true);
      }
      case 'newPendingTransactions': {
        return this.changed(id, this.httpPendingTransactions, false);
      }
    }
  }

  newPendingTransactions(hashs: Buffer[]) {
    for (const [id, filterInfo] of this.wsPendingTransactions) {
      filterInfo.client!.notifyPendingTransactions(id, hashs);
    }
    for (const [id, filterInfo] of this.httpPendingTransactions) {
      filterInfo.hashes = filterInfo.hashes.concat(hashs);
    }
  }

  newHeads(hash: Buffer) {
    for (const [id, filterInfo] of this.wsHeads) {
      // TODO: get the header.
      filterInfo.client!.notifyHeader(id, 1 as any);
    }
    for (const [id, filterInfo] of this.httpHeads) {
      filterInfo.hashes.push(hash);
    }
  }

  newLogs(logs: Log[]) {
    for (const [id, filterInfo] of this.wsLogs) {
      const filteredLogs = logs.filter((log) => BloomBitsFilter.checkLogMatches(log, filterInfo.queryInfo));
      filterInfo.client!.notifyLogs(id, filteredLogs);
    }
    for (const [id, filterInfo] of this.httpLogs) {
      const filteredLogs = logs.filter((log) => BloomBitsFilter.checkLogMatches(log, filterInfo.queryInfo));
      filterInfo.logs = filterInfo.logs.concat(filteredLogs);
    }
  }

  newSyncing(state: SyncingStatus) {
    for (const [id, filterInfo] of this.wsSyncing) {
      filterInfo.client!.notifySyncing(id, state);
    }
  }
}
