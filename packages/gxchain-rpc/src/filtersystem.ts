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

  private readonly wsHeads = new Map<string, Filter>();
  private readonly wsLogs = new Map<string, Filter>();
  private readonly wsPendingTransactions = new Map<string, Filter>();
  private readonly wsSyncing = new Map<string, Filter>();
  private readonly httpHeads = new Map<string, Filter>();
  private readonly httpLogs = new Map<string, Filter>();
  private readonly httpPendingTransactions = new Map<string, Filter>();
  private readonly httpFilterType = new Map<string, string>();

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
        this.httpFilterType.delete(key);
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

  wsSubscibe(client: WsClient, type: string, query?: Query): string {
    const uid = genSubscriptionId();
    const filter = { hashes: [], logs: [], query, client };
    switch (type) {
      case 'newHeads': {
        this.wsHeads.set(uid, filter);
        break;
      }
      case 'logs': {
        this.wsLogs.set(uid, filter);
        break;
      }
      case 'newPendingTransactions': {
        this.wsPendingTransactions.set(uid, filter);
        break;
      }
      case 'syncing': {
        this.wsSyncing.set(uid, filter);
        break;
      }
    }
    return uid;
  }

  httpSubscribe(type: string, query?: Query): string {
    const uid = genSubscriptionId();
    const filter = { hashes: [], logs: [], createtime: Date.now(), query };
    switch (type) {
      case 'newHeads': {
        this.httpHeads.set(uid, filter);
        break;
      }
      case 'logs': {
        this.httpLogs.set(uid, filter);
        break;
      }
      case 'newPendingTransactions': {
        this.httpPendingTransactions.set(uid, filter);
        break;
      }
    }
    this.httpFilterType.set(uid, type);
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
    this.httpFilterType.delete(id);
  }

  httpFilterChanges(id: string) {
    const type = this.httpFilterType.get(id);
    if (!type) {
      return;
    }
    switch (type) {
      case 'newHeads': {
        const filter = this.httpHeads.get(id);
        const hash = filter?.hashes;
        if (filter) {
          filter.hashes = [];
        }
        return hash;
      }
      case 'logs': {
        const filter = this.httpLogs.get(id);
        const logs = filter?.logs;
        if (filter) {
          filter.logs = [];
        }
        return logs;
      }
      case 'newPendingTransactions': {
        const filter = this.httpPendingTransactions.get(id);
        const hash = filter?.hashes;
        if (filter) {
          filter.hashes = [];
        }
        return hash;
      }
    }
  }

  private newPendingTransactions(hashs: Buffer[]) {
    for (const [id, filter] of this.wsPendingTransactions) {
      filter.client!.notifyPendingTransactions(id, hashs);
    }
    for (const [id, filter] of this.httpPendingTransactions) {
      filter.hashes = filter.hashes.concat(hashs);
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
      const filteredLogs = logs.filter((log) => BloomBitsFilter.checkLogMatches(log, filter.query!));
      filter.client!.notifyLogs(id, filteredLogs);
    }
    for (const [id, filter] of this.httpLogs) {
      const filteredLogs = logs.filter((log) => BloomBitsFilter.checkLogMatches(log, filter.query!));
      filter.logs = filter.logs.concat(filteredLogs);
    }
  }

  private newSyncing(state: SyncingStatus) {
    for (const [id, filter] of this.wsSyncing) {
      filter.client!.notifySyncing(id, state);
    }
  }
}
