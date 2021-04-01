import { Address, BN, bufferToHex } from 'ethereumjs-util';
import { v4 as uuidv4 } from 'uuid';
import { Aborter, AsyncChannel, logger } from '@gxchain2/utils';
import { Log } from '@gxchain2/receipt';
import { BlockHeader } from '@gxchain2/block';
import { Topics, BloomBitsFilter } from '@gxchain2/core/dist/bloombits';
import { Node } from '@gxchain2/core';
import { WsClient, SyncingStatus } from './client';

export type QueryInfo = {
  fromBlock?: BN;
  toBlock?: BN;
  addresses: Address[];
  topics: Topics;
};

const deadline = 5 * 60 * 1000;

type FilterInfo = {
  createtime: number;
  hashes: Buffer[];
  logs: Log[];
  queryInfo?: QueryInfo;
  client?: WsClient;
};

function genSubscriptionId() {
  return bufferToHex(uuidv4({}, Buffer.alloc(16, 0)));
}

class LogsTask {
  logs!: Log[];
}

class HeadsTask {
  hashes!: Buffer[];
}

class PendingTxTask {
  hashes!: Buffer[];
}

class SyncingTask {
  status!: SyncingStatus;
}

type Task = LogsTask | HeadsTask | PendingTxTask | SyncingTask;

export class FilterSystem {
  private readonly node: Node;
  private aborter = new Aborter();
  private taskQueue = new AsyncChannel<Task>({ isAbort: () => this.aborter.isAborted });

  private readonly wsHeads = new Map<string, FilterInfo>();
  private readonly wsLogs = new Map<string, FilterInfo>();
  private readonly wsPendingTransactions = new Map<string, FilterInfo>();
  private readonly wsSyncing = new Map<string, FilterInfo>();
  private readonly httpHeads = new Map<string, FilterInfo>();
  private readonly httpLogs = new Map<string, FilterInfo>();
  private readonly httpPendingTransactions = new Map<string, FilterInfo>();

  constructor(node: Node) {
    this.node = node;
    this.timeoutLoop();
    this.taskLoop();
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

  private async taskLoop() {
    for await (const task of this.taskQueue.generator()) {
      try {
        if (task instanceof LogsTask) {
          this.newLogs(task.logs);
        } else if (task instanceof HeadsTask) {
          const headers = (await Promise.all(task.hashes.map((hash) => this.node.db.tryToGetCanonicalHeader(hash)))).filter((header) => header !== undefined) as BlockHeader[];
          this.newHeads(headers);
        } else if (task instanceof PendingTxTask) {
          this.newPendingTransactions(task.hashes);
        } else if (task instanceof SyncingTask) {
          this.newSyncing(task.status);
        }
      } catch (err) {
        logger.error('FilterSystem::taskLoop, catch error:', err);
      }
    }
  }

  wsSubscibe(client: WsClient, type: string, queryInfo?: QueryInfo): string {
    const uid = genSubscriptionId();
    const filterInstance = { createtime: Date.now(), hashes: [], logs: [], queryInfo, client };
    switch (type) {
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

  httpSubscribe(type: string, queryInfo?: QueryInfo): string {
    const uid = genSubscriptionId();
    const filterInstance = { createtime: Date.now(), hashes: [], logs: [], queryInfo };
    switch (type) {
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

  private newPendingTransactions(hashs: Buffer[]) {
    for (const [id, filterInfo] of this.wsPendingTransactions) {
      filterInfo.client!.notifyPendingTransactions(id, hashs);
    }
    for (const [id, filterInfo] of this.httpPendingTransactions) {
      filterInfo.hashes = filterInfo.hashes.concat(hashs);
    }
  }

  private newHeads(heads: BlockHeader[]) {
    for (const [id, filter] of this.wsHeads) {
      filter.client!.notifyHeader(id, heads);
    }
    for (const [id, filter] of this.httpHeads) {
      filter.hashes = filter.hashes.concat(heads.map((head) => head.hash()));
    }
  }

  private newLogs(logs: Log[]) {
    for (const [id, filter] of this.wsLogs) {
      const filteredLogs = logs.filter((log) => BloomBitsFilter.checkLogMatches(log, filter.queryInfo!));
      filter.client!.notifyLogs(id, filteredLogs);
    }
    for (const [id, filter] of this.httpLogs) {
      const filteredLogs = logs.filter((log) => BloomBitsFilter.checkLogMatches(log, filter.queryInfo!));
      filter.logs = filter.logs.concat(filteredLogs);
    }
  }

  private newSyncing(state: SyncingStatus) {
    for (const [id, filter] of this.wsSyncing) {
      filter.client!.notifySyncing(id, state);
    }
  }
}
