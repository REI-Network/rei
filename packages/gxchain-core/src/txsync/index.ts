import { FunctionalMap, createBufferFunctionalMap, FunctionalSet, createBufferFunctionalSet, AysncChannel, Aborter } from '@gxchain2/utils';
import { EventEmitter } from 'events';
import { WrappedTransaction } from '@gxchain2/tx';
import { Node } from '../node';

type NewPooledTransactionMessage = {
  hashes: Buffer[];
  origin: string;
};

type EnqueuePooledTransactionMessage = {
  txs: WrappedTransaction[];
  origin: string;
};

function forceAddToStringSet<K>(map: Map<K, Set<string>>, key: K, value: string) {
  let set = map.get(key);
  if (!set) {
    set = new Set<string>();
    map.set(key, set);
  }
  set.add(value);
}

function forceAddToBufferSet<K>(map: Map<K, Set<Buffer>>, key: K, value: Buffer) {
  let set = map.get(key);
  if (!set) {
    set = createBufferFunctionalSet();
    map.set(key, set);
  }
  set.add(value);
}

export class TxFetcher extends EventEmitter {
  private waitingList = createBufferFunctionalMap<Set<string>>();
  private waitingTime = createBufferFunctionalMap<number>();
  private watingSlots = new Map<string, FunctionalSet<Buffer>>();

  private announces = new Map<string, FunctionalSet<Buffer>>();
  private announced = createBufferFunctionalMap<Set<string>>();

  private fetching = createBufferFunctionalMap<string>();
  private requests = new Map<string, { hashes: Buffer[]; stolen?: FunctionalSet<Buffer> }>();
  private alternates = createBufferFunctionalMap<Set<string>>();

  private aborter = new Aborter();
  private newPooledTransactionQueue = new AysncChannel<NewPooledTransactionMessage>({ isAbort: () => this.aborter.isAborted });
  private enqueueTransactionQueue = new AysncChannel<EnqueuePooledTransactionMessage>({ isAbort: () => this.aborter.isAborted });

  private readonly node: Node;

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
              forceAddToBufferSet(this.announces, message.origin, hash);
              continue;
            }
          }

          {
            const set = this.announced.get(hash);
            if (set) {
              set.add(message.origin);
              forceAddToBufferSet(this.announces, message.origin, hash);
              continue;
            }
          }

          {
            const set = this.waitingList.get(hash);
            if (set) {
              set.add(message.origin);
              forceAddToBufferSet(this.watingSlots, message.origin, hash);
              continue;
            }
          }

          forceAddToStringSet(this.waitingList, hash, message.origin);
          this.waitingTime.set(hash, Date.now());
          forceAddToBufferSet(this.watingSlots, message.origin, hash);
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
        const added = (await this.node.addPendingTxs(message.txs)).map((result, i) => (result ? message.txs[i] : null)).filter((ele) => ele !== null) as WrappedTransaction[];
        for (const wtx of added) {
          const hash = wtx.transaction.hash();
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

        const delivered = new Set<Buffer>(added.map((wtx) => wtx.transaction.hash()));
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
              const set = this.announces.get(message.origin);
              if (set) {
                set.delete(hash);
                if (set.size === 0) {
                  this.announces.delete(message.origin);
                }
              }
            }
            if (this.alternates.size > 0) {
              // panic
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
}
