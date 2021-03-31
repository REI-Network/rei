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

  private async cycleDelete(map: Map<any, any>) {
    const timenow = Date.now();
    for await (const [key, filter] of map) {
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
      await this.cycleDelete(this.HttpLogMap);
      await this.cycleDelete(this.HttpPendingTransactionsMap);
      await this.cycleDelete(this.HttpLogMap);
      await this.cycleDelete(this.HttpPendingLogsMap);
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

  httpFilterChanged(id: string, type: string) {
    // if type === 'PendingTransactions';
    switch (type) {
      case 'LogsSubscription': {
        const filterInfo = this.HttpLogMap.get(id);
        const loginfo = filterInfo?.logs;
        if (filterInfo?.logs) {
          filterInfo.logs = [];
        }
        return loginfo;
        break;
      }
      case 'PendingLogsSubscription': {
        const filterInfo = this.HttpPendingLogsMap.get(id);
        const pendingloginfo = filterInfo?.logs;
        if (filterInfo?.logs) {
          filterInfo.logs = [];
        }
        return pendingloginfo;
        break;
      }
      case 'MinedAndPendingLogsSubscription': {
        const filterInfo1 = this.HttpPendingLogsMap.get(id);
        const filterInfo2 = this.HttpLogMap.get(id);
        const pendingloginfo = filterInfo1?.logs;
        const loginfo = filterInfo2?.logs;
        if (filterInfo1?.logs) {
          filterInfo1.logs = [];
        }
        if (filterInfo2?.logs) {
          filterInfo2.logs = [];
        }
        return [pendingloginfo, loginfo];
        break;
      }
      case 'PendingTransactionsSubscription': {
        const filterInfo = this.HttpPendingTransactionsMap.get(id);
        const pendingtrxinfo = filterInfo?.hashes;
        if (filterInfo?.hashes) {
          filterInfo.hashes = [];
        }
        return pendingtrxinfo;
        break;
      }
      case 'BlocksSubscription': {
        const filterInfo = this.HttpHeadMap.get(id);
        const headinfo = filterInfo?.hashes;
        if (filterInfo?.hashes) {
          filterInfo.hashes = [];
        }
        return headinfo;
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
