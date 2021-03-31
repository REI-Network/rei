import { uuidv4 } from 'uuid';
import { Aborter } from '@gxchain2/utils';
import { Log } from '@gxchain2/receipt';
import { WsClient } from './client';

type FilterQuery = {
  type: string;
  BlockHash: Buffer;
  FromBlock: number;
  ToBlock: number;
  Addresses: Buffer[];
  Topics: Buffer[][];
};

const deadline = 5 * 60 * 1000;
type filterInfo = {
  type: string;
  createtime: number;
  hashes: Buffer[];
  logs: Log[];
  queryInfo: FilterQuery;
  notify?: (data: any) => void;
};

class FilterSystem {
  private aborter = new Aborter();

  private readonly initPromise: Promise<void>;

  private readonly WsPendingTransactionsMap: Map<string, filterInfo>;
  private readonly WsPendingLogsMap: Map<string, filterInfo>;
  private readonly WsLogMap: Map<string, filterInfo>;
  private readonly WsHeadMap: Map<string, filterInfo>;
  private readonly HttpPendingTransactionsMap: Map<string, filterInfo>;
  private readonly HttpPendingLogsMap: Map<string, filterInfo>;
  private readonly HttpLogMap: Map<string, filterInfo>;
  private readonly HttpHeadMap: Map<string, filterInfo>;

  constructor() {
    this.initPromise = this.init();
    this.WsPendingTransactionsMap = new Map();
    this.WsPendingLogsMap = new Map();
    this.WsHeadMap = new Map();
    this.WsLogMap = new Map();
    this.HttpHeadMap = new Map();
    this.HttpPendingTransactionsMap = new Map();
    this.HttpPendingLogsMap = new Map();
    this.HttpLogMap = new Map();

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

  private cycleDelete(map: Map<string, filterInfo>) {
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
      this.cycleDelete(this.HttpLogMap);
      this.cycleDelete(this.HttpPendingTransactionsMap);
      this.cycleDelete(this.HttpLogMap);
      this.cycleDelete(this.HttpPendingLogsMap);
    }
  }

  wsSubscibe(client: WsClient, queryInfo: FilterQuery) {
    let hashes: Buffer[] = [];
    let logs: Log[] = [];
    let filterInstance = { type: queryInfo.type, createtime: Date.now(), hashes: hashes, logs: logs, queryInfo: queryInfo, notify: client.send };
    switch (queryInfo.type) {
      case 'LogsSubscription': {
        this.WsLogMap.set(client.id, filterInstance);
        break;
      }
      case 'PendingLogsSubscription': {
        this.WsPendingLogsMap.set(client.id, filterInstance);
        break;
      }
      case 'MinedAndPendingLogsSubscription': {
        this.WsLogMap.set(client.id, filterInstance);
        this.WsPendingLogsMap.set(client.id, filterInstance);
        break;
      }
      case 'PendingTransactionsSubscription': {
        this.WsPendingTransactionsMap.set(client.id, filterInstance);
        break;
      }
      case 'BlocksSubscription': {
        this.WsHeadMap.set(client.id, filterInstance);
        break;
      }
    }
  }

  httpSubscribe(queryInfo: FilterQuery): string {
    const uid = uuidv4();
    let hashes: Buffer[] = [];
    let logs: Log[] = [];
    let filterInstance = { type: queryInfo.type, createtime: Date.now(), hashes: hashes, logs: logs, queryInfo: queryInfo };
    switch (queryInfo.type) {
      case 'LogsSubscription': {
        this.WsLogMap.set(uid, filterInstance);
        break;
      }
      case 'PendingLogsSubscription': {
        this.WsPendingLogsMap.set(uid, filterInstance);
        break;
      }
      case 'MinedAndPendingLogsSubscription': {
        this.WsLogMap.set(uid, filterInstance);
        this.WsPendingLogsMap.set(uid, filterInstance);
        break;
      }
      case 'PendingTransactionsSubscription': {
        this.WsPendingTransactionsMap.set(uid, filterInstance);
        break;
      }
      case 'BlocksSubscription': {
        this.WsHeadMap.set(uid, filterInstance);
        break;
      }
    }
    return uid;
  }

  private changed(id: string, map: Map<string, filterInfo>, logorhash: boolean) {
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
        return this.changed(id, this.HttpLogMap, true);
        break;
      }
      case 'PendingLogsSubscription': {
        return this.changed(id, this.HttpPendingLogsMap, true);
        break;
      }
      case 'MinedAndPendingLogsSubscription': {
        return [this.changed(id, this.HttpLogMap, true), this.changed(id, this.HttpPendingLogsMap, true)];
        break;
      }
      case 'PendingTransactionsSubscription': {
        return this.changed(id, this.HttpPendingTransactionsMap, false);
        break;
      }
      case 'BlocksSubscription': {
        return this.changed(id, this.HttpHeadMap, false);
        break;
      }
    }
  }

  newPendingTransactions(hash: Buffer) {
    for (const [id, filterInfo] of this.WsPendingTransactionsMap) {
      if (filterInfo.notify) {
        filterInfo.notify(hash);
      }
    }
    for (const [id, filterInfo] of this.HttpPendingTransactionsMap) {
      filterInfo.hashes.push(hash);
    }
  }

  newHeads(hash: Buffer) {
    for (const [id, filterInfo] of this.WsHeadMap) {
      if (filterInfo.notify) {
        filterInfo.notify(hash);
      }
    }
    for (const [id, filterInfo] of this.HttpHeadMap) {
      filterInfo.hashes.push(hash);
    }
  }
}
