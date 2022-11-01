import { Address, BN, bufferToHex, toBuffer, bnToHex } from 'ethereumjs-util';
import { v4 as uuidv4 } from 'uuid';
import { AbortableTimer, Channel, logger } from '@rei-network/utils';
import { Topics, BloomBitsFilter } from '@rei-network/core';
import { Transaction, Log, BlockHeader } from '@rei-network/structure';
import { Node } from '@rei-network/core';
import { SyncingStatus, Client } from './types';

type Query = {
  fromBlock?: BN;
  toBlock?: BN;
  addresses: Address[];
  topics: Topics;
};

const deadline = 5 * 60 * 1000;

type Filter = {
  hashes: Buffer[];
  logs: Log[];
  creationTime?: number;
  query?: Query;
  client?: Client;
};

/**
 * Generate subscription id
 * @returns Subscription id
 */
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

/**
 * Filter subscribe information for client
 */
export class FilterSystem {
  private readonly node: Node;
  private readonly taskQueue = new Channel<Task>();
  private readonly timer = new AbortableTimer();

  private aborted: boolean = false;

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
  }

  private onLogs = (logs) => {
    this.taskQueue.push(new LogsTask(logs));
  };

  private onRemovedLogs = (logs) => {
    this.taskQueue.push(new LogsTask(logs));
  };

  private onNewHeads = (hashes) => {
    this.taskQueue.push(new HeadsTask(hashes));
  };

  private onStart = () => {
    const status = this.node.sync.status;
    const syncingStatus: SyncingStatus = {
      syncing: true,
      status: {
        startingBlock: bufferToHex(toBuffer(status.startingBlock)),
        currentBlock: bnToHex(this.node.getLatestBlock().header.number),
        highestBlock: bufferToHex(toBuffer(status.highestBlock))
      }
    };
    this.taskQueue.push(new SyncingTask(syncingStatus));
  };

  private onFailed = () => {
    this.taskQueue.push(new SyncingTask(false));
  };

  private onSynchronized = () => {
    this.taskQueue.push(new SyncingTask(false));
  };

  private onReadies = (readies: Transaction[]) => {
    this.taskQueue.push(new PendingTxTask(readies.map((tx) => tx.hash())));
  };

  private deleteTimeout(map: Map<string, Filter>, now: number) {
    for (const [key, filter] of map) {
      if (now - filter.creationTime! > deadline) {
        map.delete(key);
        this.filterType.delete(key);
      }
    }
  }

  private deleteClosed(map: Map<string, Filter>) {
    for (const [key, filter] of map) {
      if (filter.client!.isClosed === true) {
        map.delete(key);
      }
    }
  }

  /**
   * Start filter system
   */
  start() {
    this.timeoutLoop();
    this.taskLoop();
    this.node.bcMonitor.on('logs', this.onLogs);
    this.node.bcMonitor.on('removedLogs', this.onRemovedLogs);
    this.node.bcMonitor.on('newHeads', this.onNewHeads);
    this.node.sync.on('start', this.onStart);
    this.node.sync.on('failed', this.onFailed);
    this.node.sync.on('synchronized', this.onSynchronized);
    this.node.txPool.on('readies', this.onReadies);
  }

  /**
   * Abort filter system
   */
  abort() {
    this.taskQueue.abort();
    this.node.bcMonitor.off('logs', this.onLogs);
    this.node.bcMonitor.off('removedLogs', this.onRemovedLogs);
    this.node.bcMonitor.off('newHeads', this.onNewHeads);
    this.node.sync.off('start', this.onStart);
    this.node.sync.off('failed', this.onFailed);
    this.node.sync.off('synchronized', this.onSynchronized);
    this.node.txPool.off('readies', this.onReadies);
    this.aborted = true;
    this.timer.abort();
  }

  /**
   * A loop to delete timeout filter
   */
  private async timeoutLoop() {
    while (!this.aborted) {
      const now = Date.now();
      this.deleteTimeout(this.filterHeads, now);
      this.deleteTimeout(this.filterLogs, now);
      this.deleteTimeout(this.filterPendingTransactions, now);
      this.deleteClosed(this.subscribeHeads);
      this.deleteClosed(this.subscribeLogs);
      this.deleteClosed(this.subscribePendingTransactions);
      this.deleteClosed(this.subscribeSyncing);

      await this.timer.wait(deadline);
    }
  }

  /**
   * A loop to handle blockchain event
   */
  private async taskLoop() {
    for await (const task of this.taskQueue) {
      try {
        if (task instanceof LogsTask) {
          this.newLogs(task.logs);
        } else if (task instanceof HeadsTask) {
          const headers: BlockHeader[] = [];
          for (const hash of task.hashes) {
            // make sure the block we get is on the canonical chain
            try {
              const num: BN = await this.node.db.hashToNumber(hash);
              const hashInDB: Buffer = await this.node.db.numberToHash(num);
              if (hashInDB.equals(hash)) {
                headers.push(await this.node.db.getHeader(hash, num));
              }
            } catch (err) {
              // ignore errors
            }
          }
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

  /**
   * Subscription operation, categorize subscription types, including
   * `newHeads`, `logs`, `newPendingTransactions`, `syncing`, then set
   * into map
   * @param client - Websocket client
   * @param type - Subscription type
   * @param query - Query option
   * @returns Subscription id
   */
  subscribe(client: Client, type: string, query?: Query): string {
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

  /**
   * Creates a filter object, based on filter options
   * @param type - Filter type
   * @param query - Query option
   * @returns Filter id
   */
  newFilter(type: string, query?: Query): string {
    const uid = genSubscriptionId();
    const filter = { hashes: [], logs: [], creationTime: Date.now(), query };
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

  /**
   * Unsubscribe subscription
   * @param id - Subscription id
   * @returns `true` if sucessfully deleted
   */
  unsubscribe(id: string) {
    let result = this.subscribeHeads.delete(id);
    result = this.subscribeLogs.delete(id) || result;
    result = this.subscribePendingTransactions.delete(id) || result;
    result = this.subscribeSyncing.delete(id) || result;
    return result;
  }

  /**
   * Uninstall filter
   * @param id - Filter id
   * @returns `true` if sucessfully deleted
   */
  uninstall(id: string) {
    let result = this.filterHeads.delete(id);
    result = this.filterLogs.delete(id) || result;
    result = this.filterPendingTransactions.delete(id) || result;
    result = this.filterType.delete(id) || result;
    return result;
  }

  /**
   * Get the query information of filter
   * @param id - Filter id
   * @returns Query object
   */
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

  /**
   * Get the data changed in the filter
   * @param id - Filter id
   * @returns Changed data
   */
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

  /**
   * Notify new pending transactions to all subscribed client
   * @param hashs - Transaction hashes
   */
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

  /**
   * Notify new heads to all subscribed client
   * @param heads - Block headers
   */
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

  /**
   * Notify new logs to all subscribed client
   * @param logs - Transaction logs
   */
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

  /**
   * Notify sync status to all subscribed client
   * @param state - Sync state
   */
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
