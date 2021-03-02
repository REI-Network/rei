import { FunctionalMap, createBufferFunctionalMap, FunctionalSet, createBufferFunctionalSet, AysncChannel, Aborter } from '@gxchain2/utils';
import { EventEmitter } from 'events';

type NewPooledTransactionMessage = {
  hashes: Buffer[];
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
  private requests = new Map<string, Promise<any>>();
  private alternates = createBufferFunctionalMap<Set<string>>();

  private aborter = new Aborter();
  private newPooledTransactionQueue = new AysncChannel<NewPooledTransactionMessage>({ isAbort: () => this.aborter.isAborted });
  private enqueueTransactionQueue = new AysncChannel({ isAbort: () => this.aborter.isAborted });

  constructor() {
    super();
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
}
