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

  private readonly wsHeadMap: Map<string, FilterInfo> = new Map();
  private readonly wsLogMap: Map<string, FilterInfo> = new Map();
  private readonly wsPendingTransactionsMap: Map<string, FilterInfo> = new Map();
  private readonly wsSyncingMap: Map<string, FilterInfo> = new Map();
  private readonly httpHeadMap: Map<string, FilterInfo> = new Map();
  private readonly httpLogMap: Map<string, FilterInfo> = new Map();
  private readonly httpPendingTransactionsMap: Map<string, FilterInfo> = new Map();

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
    }
  }

  wsSubscibe(client: WsClient, queryInfo: FilterQuery): string {
    const uid = uuidv4();
    const filterInstance = { type: queryInfo.type, createtime: Date.now(), hashes: [], logs: [], queryInfo: queryInfo, notify: client.send };
    switch (queryInfo.type) {
      case 'newHeads': {
        this.wsHeadMap.set(uid, filterInstance);
        break;
      }
      case 'logs': {
        this.wsLogMap.set(uid, filterInstance);
        break;
      }
      case 'newPendingTransactions': {
        this.wsPendingTransactionsMap.set(uid, filterInstance);
        break;
      }
      case 'syncing': {
        this.wsSyncingMap.set(uid, filterInstance);
        break;
      }
    }
    return uid;
  }

  httpSubscribe(queryInfo: FilterQuery): string {
    const uid = uuidv4();
    const filterInstance = { type: queryInfo.type, createtime: Date.now(), hashes: [], logs: [], queryInfo: queryInfo };
    switch (queryInfo.type) {
      case 'newHeads': {
        this.httpHeadMap.set(uid, filterInstance);
        break;
      }
      case 'logs': {
        this.httpLogMap.set(uid, filterInstance);
        break;
      }
      case 'newPendingTransactions': {
        this.httpPendingTransactionsMap.set(uid, filterInstance);
        break;
      }
    }
    return uid;
  }

  wsUnsubscribe(id: string) {
    this.wsHeadMap.delete(id);
    this.wsLogMap.delete(id);
    this.wsPendingTransactionsMap.delete(id);
    this.wsSyncingMap.delete(id);
  }

  httpUnsubscribe(id: string) {
    this.httpHeadMap.delete(id);
    this.httpLogMap.delete(id);
    this.httpPendingTransactionsMap.delete(id);
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
    // if type === 'PendingTransactions';
    switch (type) {
      case 'newHeads': {
        return this.changed(id, this.httpHeadMap, false);
      }
      case 'logs': {
        return this.changed(id, this.httpLogMap, true);
      }
      case 'newPendingTransactions': {
        return this.changed(id, this.httpPendingTransactionsMap, false);
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

  // private includes()

  // filterLogs(logs: Log[], filterinstance: FilterInfo) {
  //   for (const log of logs) {
  //     if (filterinstance.queryInfo.fromBlock >= 0 && filterinstance.queryInfo.fromBlock > log.blockNumber!.toNumber()) {
  //       continue;
  //     }
  //     if (filterinstance.queryInfo.toBlock >= 0 && filterinstance.queryInfo.toBlock < log.blockNumber!.toNumber()) {
  //       continue;
  //     }
  //     if (filterinstance.queryInfo.addresses.length > 0 && ) {
  //       continue
  //     }
  //   }
  // }
}
