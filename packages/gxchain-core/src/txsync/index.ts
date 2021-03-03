import { FunctionalMap, createBufferFunctionalMap, FunctionalSet, createBufferFunctionalSet, AysncChannel, Aborter } from '@gxchain2/utils';
import { EventEmitter } from 'events';
import { Transaction } from '@gxchain2/tx';
import { Node } from '../node';

type NewPooledTransactionMessage = {
  hashes: Buffer[];
  origin: string;
};

type EnqueuePooledTransactionMessage = {
  txs: Transaction[];
  origin: string;
};

function forceAdd<K>(map: Map<K, Set<Buffer | string>>, key: K, value: Buffer | string) {
  let set = map.get(key);
  if (!set) {
    set = typeof value === 'string' ? new Set<string>() : createBufferFunctionalSet();
    map.set(key, set);
  }
  set.add(value);
}

function autoDelete<K>(map: Map<K, Set<Buffer | string>>, key: K, value: Buffer | string) {
  let set = map.get(key);
  if (set) {
    set.delete(value);
    if (set.size === 0) {
      map.delete(key);
    }
  }
}

const txArriveTimeout = 500;
const gatherSlack = 100;
const txGatherSlack = 100;
const maxTxRetrievals = 256;

type Request = { hashes: Buffer[]; stolen?: FunctionalSet<Buffer> };

export class TxFetcher extends EventEmitter {
  private waitingList = createBufferFunctionalMap<Set<string>>();
  private waitingTime = createBufferFunctionalMap<number>();
  private watingSlots = new Map<string, FunctionalSet<Buffer>>();

  private announces = new Map<string, FunctionalSet<Buffer>>();
  private announced = createBufferFunctionalMap<Set<string>>();

  private fetching = createBufferFunctionalMap<string>();
  private requests = new Map<string, Request>();
  private alternates = createBufferFunctionalMap<Set<string>>();

  private aborter = new Aborter();
  private newPooledTransactionQueue = new AysncChannel<NewPooledTransactionMessage>({ isAbort: () => this.aborter.isAborted });
  private enqueueTransactionQueue = new AysncChannel<EnqueuePooledTransactionMessage>({ isAbort: () => this.aborter.isAborted });

  private readonly node: Node;

  private waitTimeout?: NodeJS.Timeout;

  constructor(node: Node) {
    super();
    this.node = node;
  }

  private async newPooledTransactionLoop() {
    try {
      for await (const message of this.newPooledTransactionQueue.generator()) {
        const used = (this.watingSlots.get(message.origin)?.size || 0) + (this.announces.get(message.origin)?.size || 0);
        if (used > 4096) {
          continue;
        }
        const want = used + message.hashes.length;
        if (want > 4096) {
          message.hashes.splice(message.hashes.length - (want - 4096));
        }
        const idleWait = this.waitingTime.size === 0;
        const oldPeer = this.announces.has(message.origin);

        for (const hash of message.hashes) {
          {
            const set = this.alternates.get(hash);
            if (set) {
              set.add(message.origin);
              forceAdd(this.announces, message.origin, hash);
              continue;
            }
          }

          {
            const set = this.announced.get(hash);
            if (set) {
              set.add(message.origin);
              forceAdd(this.announces, message.origin, hash);
              continue;
            }
          }

          {
            const set = this.waitingList.get(hash);
            if (set) {
              set.add(message.origin);
              forceAdd(this.watingSlots, message.origin, hash);
              continue;
            }
          }

          forceAdd(this.waitingList, hash, message.origin);
          this.waitingTime.set(hash, Date.now());
          forceAdd(this.watingSlots, message.origin, hash);
        }

        if (idleWait && this.waitingTime.size > 0) {
          // rescheduleWait
        }
        const set = this.announces.get(message.origin);
        if (!oldPeer && set && set.size > 0) {
          // scheduleFetches
        }
      }
    } catch (err) {}
  }

  private async enqueueTransactionLoop() {
    try {
      for await (const message of this.enqueueTransactionQueue.generator()) {
        // TODO: check underpriced and duplicate and etc.
        const added = (await this.node.addPendingTxs(message.txs)).map((result, i) => (result ? message.txs[i] : null)).filter((ele) => ele !== null) as Transaction[];
        for (const tx of added) {
          const hash = tx.hash();
          const set = this.waitingList.get(hash);
          if (set) {
            for (const [origin, txset] of this.watingSlots) {
              txset.delete(hash);
              if (txset.size === 0) {
                this.watingSlots.delete(origin);
              }
            }
            this.waitingList.delete(hash);
            this.waitingTime.delete(hash);
          } else {
            for (const [origin, txset] of this.announces) {
              txset.delete(hash);
              if (txset.size === 0) {
                this.announces.delete(origin);
              }
            }
            this.announced.delete(hash);
            this.alternates.delete(hash);

            const origin = this.fetching.get(hash);
            if (origin !== undefined && origin !== message.origin) {
              const req = this.requests.get(origin);
              // set stolen
            }
            this.fetching.delete(hash);
          }
        }

        const req = this.requests.get(message.origin);
        if (!req) {
          // TODO
          console.warn('unknow error');
          continue;
        }
        this.requests.delete(message.origin);

        const delivered = new Set<Buffer>(added.map((tx) => tx.hash()));
        let cutoff = req.hashes.length;
        for (let i = 0; i < req.hashes.length; i++) {
          if (delivered.has(req.hashes[i])) {
            cutoff = i;
          }
        }

        for (let i = 0; i < req.hashes.length; i++) {
          const hash = req.hashes[i];
          if (req.stolen && req.stolen.has(hash)) {
            continue;
          }
          if (!delivered.has(hash)) {
            if (i < cutoff) {
              this.alternates.get(hash)?.delete(message.origin);
              autoDelete(this.announces, message.origin, hash);
            }
            if (this.alternates.size > 0) {
              if (this.announced.has(hash)) {
                // panic
              }
              this.announced.set(hash, this.alternates.get(hash)!);
            }
          }
          this.alternates.delete(hash);
          this.fetching.delete(hash);
        }
        // scheduleFetches
      }
    } catch (err) {}
  }

  private rescheduleWait() {
    if (this.waitTimeout) {
      clearTimeout(this.waitTimeout);
      this.waitTimeout = undefined;
    }
    const now = Date.now();
    let earliest = now;
    for (const [hash, instance] of this.waitingTime) {
      if (earliest > instance) {
        earliest = instance;
        if (txArriveTimeout - (now - earliest) < gatherSlack) {
          break;
        }
      }
    }
    this.waitTimeout = setTimeout(() => {
      const now = Date.now();
      const actives = new Set<string>();
      for (const [hash, instance] of this.waitingTime) {
        if (now - instance + txGatherSlack > txArriveTimeout) {
          if (this.announced.has(hash)) {
            // panic
          }
          const set = this.waitingList.get(hash)!;
          this.announced.set(hash, set);
          for (const peer of set) {
            forceAdd(this.announces, peer, hash);
            autoDelete(this.watingSlots, peer, hash);
            actives.add(peer);
          }
          this.waitingTime.delete(hash);
          this.waitingList.delete(hash);
        }
      }
      if (this.waitingList.size > 0) {
        this.rescheduleWait();
      }
      if (actives.size > 0) {
        // scheduleFetches
      }
    }, txArriveTimeout - (now - earliest));
  }

  private scheduleFetches(whiteList?: Set<string>) {
    const actives = whiteList ? new Set<string>(whiteList) : new Set<string>(this.announces.keys());
    if (actives.size === 0) {
      return;
    }
    const idle = this.requests.size === 0;

    for (const peer of actives) {
      if (this.requests.has(peer)) {
        continue;
      }
      const set = this.announces.get(peer);
      if (!set || set.size === 0) {
        continue;
      }

      const hashes: Buffer[] = [];
      for (const hash of set) {
        if (!this.fetching.has(hash)) {
          this.fetching.set(hash, peer);
          if (this.alternates.has(hash)) {
            // panic
          }
          const alters = this.announced.get(hash);
          if (alters) {
            this.alternates.set(hash, alters);
            this.announced.delete(hash);
          }

          hashes.push(hash);
          if (hashes.length === maxTxRetrievals) {
            break;
          }
        }
      }

      if (hashes.length > 0) {
        this.requests.set(peer, { hashes });
        const p = this.node.peerpool.getPeer(peer);
        if (!p) {
          // drop peer
        } else {
          p.getPooledTransactions(hashes)
            .then((txs) => {
              this.enqueueTransaction(peer, txs);
            })
            .catch((err) => {
              // drop peer
              this.emit('error', err);
            });
        }
      }
    }

    if (idle && this.requests.size > 0) {
      // rescheduleTimeout
    }
  }

  enqueueTransaction(origin: string, txs: Transaction[]) {
    this.enqueueTransactionQueue.push({ txs, origin });
  }
}
