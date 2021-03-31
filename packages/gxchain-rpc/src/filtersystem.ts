import { uuidv4 } from 'uuid';
import { Aborter } from '@gxchain2/utils';
import { Log } from '@gxchain2/receipt';
import { WsClient } from './client';

type FilterQuery = {
  type: string;
  blockHash: Buffer;
  fromBlock: number;
  toBlock: number;
  addresses: Buffer[];
  topics: Buffer[][];
};

const deadline = 5 * 60 * 1000;

export type FilterInfo = {
  type: string;
  createtime: number;
  hashes: Buffer[];
  logs: Log[];
  queryInfo: FilterQuery;
  notify?: (data: any) => void;
};

export class FilterSystem {
  private aborter = new Aborter();

  private readonly initPromise: Promise<void>;

  private readonly wsPendingTransactionsMap: Map<string, FilterInfo> = new Map();
  private readonly wsPendingLogsMap: Map<string, FilterInfo> = new Map();
  private readonly wsLogMap: Map<string, FilterInfo> = new Map();
  private readonly wsHeadMap: Map<string, FilterInfo> = new Map();
  private readonly httpPendingTransactionsMap: Map<string, FilterInfo> = new Map();
  private readonly httpPendingLogsMap: Map<string, FilterInfo> = new Map();
  private readonly httpLogMap: Map<string, FilterInfo> = new Map();
  private readonly httpHeadMap: Map<string, FilterInfo> = new Map();

  constructor() {
    this.initPromise = this.init();
    this.timeoutLoop();
  }
  async abort() {
    await this.aborter.abort();
  }

  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
  }

  private cycleDelete(map: Map<string, FilterInfo>) {
    const timenow = Date.now();
    for (const [key, filter] of map) {
      if (timenow - filter.createtime > deadline) {
        map.delete(key);
      }
    }
  }

  private async timeoutLoop() {
    await this.initPromise;
    while (!this.aborter.isAborted) {
      await this.aborter.abortablePromise(new Promise((r) => setTimeout(r, deadline)));
      if (this.aborter.isAborted) {
        break;
      }
      this.cycleDelete(this.httpLogMap);
      this.cycleDelete(this.httpPendingTransactionsMap);
      this.cycleDelete(this.httpLogMap);
      this.cycleDelete(this.httpPendingLogsMap);
    }
  }

  wsSubscibe(client: WsClient, queryInfo: FilterQuery): string {
    let hashes: Buffer[] = [];
    let logs: Log[] = [];
    const uid = uuidv4();
    let filterInstance = { type: queryInfo.type, createtime: Date.now(), hashes: hashes, logs: logs, queryInfo: queryInfo, notify: client.send };
    switch (queryInfo.type) {
      case 'LogsSubscription': {
        this.wsLogMap.set(uid, filterInstance);
        break;
      }
      case 'PendingLogsSubscription': {
        this.wsPendingLogsMap.set(uid, filterInstance);
        break;
      }
      case 'MinedAndPendingLogsSubscription': {
        this.wsLogMap.set(uid, filterInstance);
        this.wsPendingLogsMap.set(uid, filterInstance);
        break;
      }
      case 'PendingTransactionsSubscription': {
        this.wsPendingTransactionsMap.set(uid, filterInstance);
        break;
      }
      case 'BlocksSubscription': {
        this.wsHeadMap.set(uid, filterInstance);
        break;
      }
    }
    return uid;
  }

  httpSubscribe(queryInfo: FilterQuery): string {
    const uid = uuidv4();
    let hashes: Buffer[] = [];
    let logs: Log[] = [];
    let filterInstance = { type: queryInfo.type, createtime: Date.now(), hashes: hashes, logs: logs, queryInfo: queryInfo };
    switch (queryInfo.type) {
      case 'LogsSubscription': {
        this.httpLogMap.set(uid, filterInstance);
        break;
      }
      case 'PendingLogsSubscription': {
        this.httpPendingLogsMap.set(uid, filterInstance);
        break;
      }
      case 'MinedAndPendingLogsSubscription': {
        this.httpLogMap.set(uid, filterInstance);
        this.httpPendingLogsMap.set(uid, filterInstance);
        break;
      }
      case 'PendingTransactionsSubscription': {
        this.httpPendingTransactionsMap.set(uid, filterInstance);
        break;
      }
      case 'BlocksSubscription': {
        this.httpHeadMap.set(uid, filterInstance);
        break;
      }
    }
    return uid;
  }

  private removeFromMap(id: string, map: Map<string, FilterInfo>) {
    if (map.has(id)) {
      map.delete(id);
    }
  }

  wsUnsubscribe(id: string) {
    this.removeFromMap(id, this.wsHeadMap);
    this.removeFromMap(id, this.wsLogMap);
    this.removeFromMap(id, this.wsPendingLogsMap);
    this.removeFromMap(id, this.wsPendingTransactionsMap);
  }

  httpUnsubscribe(id: string) {
    this.removeFromMap(id, this.httpHeadMap);
    this.removeFromMap(id, this.httpLogMap);
    this.removeFromMap(id, this.httpPendingLogsMap);
    this.removeFromMap(id, this.httpPendingTransactionsMap);
  }

  private changed(id: string, map: Map<string, FilterInfo>, logorhash: boolean) {
    const filterInfo = map.get(id);
    if (logorhash) {
      const info = filterInfo?.logs;
      if (filterInfo?.logs) {
        filterInfo.logs = [];
      }
      return info;
    } else {
      const info = filterInfo?.hashes;
      if (filterInfo?.hashes) {
        filterInfo.hashes = [];
      }
      return info;
    }
  }

  httpFilterChanged(id: string, type: string) {
    // if type === 'PendingTransactions';
    switch (type) {
      case 'LogsSubscription': {
        return this.changed(id, this.httpLogMap, true);
      }
      case 'PendingLogsSubscription': {
        return this.changed(id, this.httpPendingLogsMap, true);
        break;
      }
      case 'MinedAndPendingLogsSubscription': {
        return [this.changed(id, this.httpLogMap, true), this.changed(id, this.httpPendingLogsMap, true)];
        break;
      }
      case 'PendingTransactionsSubscription': {
        return this.changed(id, this.httpPendingTransactionsMap, false);
        break;
      }
      case 'BlocksSubscription': {
        return this.changed(id, this.httpHeadMap, false);
        break;
      }
    }
  }

  newPendingTransactions(hash: Buffer) {
    for (const [id, filterInfo] of this.wsPendingTransactionsMap) {
      if (filterInfo.notify) {
        filterInfo.notify(hash);
      }
    }
    for (const [id, filterInfo] of this.httpPendingTransactionsMap) {
      filterInfo.hashes.push(hash);
    }
  }

  newHeads(hash: Buffer) {
    for (const [id, filterInfo] of this.wsHeadMap) {
      if (filterInfo.notify) {
        filterInfo.notify(hash);
      }
    }
    for (const [id, filterInfo] of this.httpHeadMap) {
      filterInfo.hashes.push(hash);
    }
  }
}
