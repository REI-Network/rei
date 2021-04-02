import { Address, BN, bufferToHex } from 'ethereumjs-util';
import { v4 as uuidv4 } from 'uuid';
import { Aborter, AsyncChannel, logger } from '@gxchain2/utils';
import { Log } from '@gxchain2/receipt';
import { BlockHeader } from '@gxchain2/block';
import { Topics, BloomBitsFilter } from '@gxchain2/core/dist/bloombits';
import { Node } from '@gxchain2/core';
import { WsClient, SyncingStatus } from './client';

export type Query = {
  fromBlock?: BN;
  toBlock?: BN;
  addresses: Address[];
  topics: Topics;
};

const deadline = 5 * 60 * 1000;

type Filter = {
  hashes: Buffer[];
  logs: Log[];
  createtime?: number;
  query?: Query;
  client?: WsClient;
};

function genSubscriptionId() {
  return bufferToHex(uuidv4({}, Buffer.alloc(16, 0)));
}

class LogsTask {
  logs: Log[];
  constructor(logs: Log[]) {
    this.logs = logs;
  }
}

class HeadsTask {
  hashes: Buffer[];
  constructor(hashes: Buffer[]) {
    this.hashes = hashes;
  }
}

class PendingTxTask {
  hashes: Buffer[];
  constructor(hashes: Buffer[]) {
    this.hashes = hashes;
  }
}

class SyncingTask {
  status: SyncingStatus;
  constructor(status: SyncingStatus) {
    this.status = status;
  }
}

type Task = LogsTask | HeadsTask | PendingTxTask | SyncingTask;

export class FilterSystem {
  private readonly node: Node;
  private aborter = new Aborter();
  private taskQueue = new AsyncChannel<Task>({ isAbort: () => this.aborter.isAborted });

  private readonly subscribeHeads = new Map<string, Filter>();
  private readonly subscribeLogs = new Map<string, Filter>();
  private readonly subscribePendingTransactions = new Map<string, Filter>();
  private readonly subscribeSyncing = new Map<string, Filter>();
  private readonly filterHeads = new Map<string, Filter>();
  private readonly filterLogs = new Map<string, Filter>();
  private readonly filterPendingTransactions = new Map<string, Filter>();
  private readonly filterType = new Map<string, string>();

  constructor(node: Node) {
    this.node = node;
    this.timeoutLoop();
    this.taskLoop();
    this.node.bcMonitor.on('logs', (logs) => {
      this.taskQueue.push(new LogsTask(logs));
    });
    this.node.bcMonitor.on('removedLogs', (logs) => {
      this.taskQueue.push(new LogsTask(logs));
    });
    this.node.bcMonitor.on('newHeads', (hashes) => {
      this.taskQueue.push(new HeadsTask(hashes));
    });
  }

  private cycleDelete(map: Map<string, Filter>) {
    const timenow = Date.now();
    for (const [key, filter] of map) {
      if (timenow - filter.createtime! > deadline) {
        map.delete(key);
        this.filterType.delete(key);
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
      this.cycleDelete(this.filterHeads);
      this.cycleDelete(this.filterLogs);
      this.cycleDelete(this.filterPendingTransactions);
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

  subscribe(client: WsClient, type: string, query?: Query): string {
    const uid = genSubscriptionId();
    const filter = { hashes: [], logs: [], query, client };
    switch (type) {
      case 'newHeads': {
        this.subscribeHeads.set(uid, filter);
        break;
      }
      case 'logs': {
        this.subscribeLogs.set(uid, filter);
        break;
      }
      case 'newPendingTransactions': {
        this.subscribePendingTransactions.set(uid, filter);
        break;
      }
      case 'syncing': {
        this.subscribeSyncing.set(uid, filter);
        break;
      }
    }
    return uid;
  }

  newFilter(type: string, query?: Query): string {
    const uid = genSubscriptionId();
    const filter = { hashes: [], logs: [], createtime: Date.now(), query };
    switch (type) {
      case 'newHeads': {
        this.filterHeads.set(uid, filter);
        break;
      }
      case 'logs': {
        this.filterLogs.set(uid, filter);
        break;
      }
      case 'newPendingTransactions': {
        this.filterPendingTransactions.set(uid, filter);
        break;
      }
    }
    this.filterType.set(uid, type);
    return uid;
  }

  unsubscribe(id: string) {
    return this.subscribeHeads.delete(id) || this.subscribeLogs.delete(id) || this.subscribePendingTransactions.delete(id) || this.subscribeSyncing.delete(id);
  }

  uninstall(id: string) {
    return this.filterHeads.delete(id) || this.filterLogs.delete(id) || this.filterPendingTransactions.delete(id) || this.filterType.delete(id);
  }

  getFilterQuery(id: string) {
    const type = this.filterType.get(id);
    if (!type) {
      return;
    }
    switch (type) {
      case 'newHeads': {
        return this.filterHeads.get(id)?.query;
      }
      case 'logs': {
        return this.filterLogs.get(id)?.query;
      }
      case 'newPendingTransactions': {
        return this.filterPendingTransactions.get(id)?.query;
      }
    }
  }

  filterChanges(id: string) {
    const type = this.filterType.get(id);
    if (!type) {
      return;
    }
    switch (type) {
      case 'newHeads': {
        const filter = this.filterHeads.get(id);
        const hash = filter?.hashes;
        if (filter) {
          filter.hashes = [];
        }
        return hash;
      }
      case 'logs': {
        const filter = this.filterLogs.get(id);
        const logs = filter?.logs;
        if (filter) {
          filter.logs = [];
        }
        return logs;
      }
      case 'newPendingTransactions': {
        const filter = this.filterPendingTransactions.get(id);
        const hash = filter?.hashes;
        if (filter) {
          filter.hashes = [];
        }
        return hash;
      }
    }
  }

  private newPendingTransactions(hashs: Buffer[]) {
    for (const [id, filter] of this.subscribePendingTransactions) {
      if (filter.client!.isClosed) {
        this.subscribePendingTransactions.delete(id);
      } else {
        filter.client!.notifyPendingTransactions(id, hashs);
      }
    }
    for (const [id, filter] of this.filterPendingTransactions) {
      filter.hashes = filter.hashes.concat(hashs);
    }
  }

  private newHeads(heads: BlockHeader[]) {
    for (const [id, filter] of this.subscribeHeads) {
      if (filter.client!.isClosed) {
        this.subscribeHeads.delete(id);
      } else {
        filter.client!.notifyHeader(id, heads);
      }
    }
    for (const [id, filter] of this.filterHeads) {
      filter.hashes = filter.hashes.concat(heads.map((head) => head.hash()));
    }
  }

  private newLogs(logs: Log[]) {
    for (const [id, filter] of this.subscribeLogs) {
      if (filter.client!.isClosed) {
        this.subscribeLogs.delete(id);
      } else {
        const filteredLogs = logs.filter((log) => BloomBitsFilter.checkLogMatches(log, filter.query!));
        if (filteredLogs.length > 0) {
          filter.client!.notifyLogs(id, filteredLogs);
        }
      }
    }
    for (const [id, filter] of this.filterLogs) {
      const filteredLogs = logs.filter((log) => BloomBitsFilter.checkLogMatches(log, filter.query!));
      if (filteredLogs.length > 0) {
        filter.logs = filter.logs.concat(filteredLogs);
      }
    }
  }

  private newSyncing(state: SyncingStatus) {
    for (const [id, filter] of this.subscribeSyncing) {
      if (filter.client!.isClosed) {
        this.subscribeSyncing.delete(id);
      } else {
        filter.client!.notifySyncing(id, state);
      }
    }
  }
}
