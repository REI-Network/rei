import { createBufferFunctionalMap, FunctionalSet, createBufferFunctionalSet, AysncChannel, Aborter } from '@gxchain2/utils';
import { EventEmitter } from 'events';
import { Transaction } from '@gxchain2/tx';
import { PeerRequestTimeoutError } from '@gxchain2/network';
import { Node } from '../node';
import { bufferToHex } from 'ethereumjs-util';

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

function panicError(...args: any[]) {
  console.error('TxFetcher, panic error:', ...args);
}

const txArriveTimeout = 500;
const gatherSlack = 100;
const txGatherSlack = 100;
const maxTxRetrievals = 256;
const maxTxAnnounces = 4096;

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
    this.newPooledTransactionLoop();
    this.enqueueTransactionLoop();
  }

  private async newPooledTransactionLoop() {
    try {
      for await (const message of this.newPooledTransactionQueue.generator()) {
        console.debug(
          'new pooled txs',
          message.hashes.map((h) => bufferToHex(h)),
          'from',
          message.origin
        );

        const used = (this.watingSlots.get(message.origin)?.size || 0) + (this.announces.get(message.origin)?.size || 0);
        if (used > maxTxAnnounces) {
          continue;
        }
        const want = used + message.hashes.length;
        if (want > maxTxAnnounces) {
          message.hashes.splice(message.hashes.length - (want - maxTxAnnounces));
        }
        const idleWait = this.waitingTime.size === 0;
        const oldPeer = this.announces.has(message.origin);

        for (const hash of message.hashes) {
          {
            const set = this.alternates.get(hash);
            if (set) {
              set.add(message.origin);
              forceAdd(this.announces, message.origin, hash);
              console.debug('new pooled txs, alternates has hash', bufferToHex(hash));
              continue;
            }
          }

          {
            const set = this.announced.get(hash);
            if (set) {
              set.add(message.origin);
              forceAdd(this.announces, message.origin, hash);
              console.debug('new pooled txs, announced has hash', bufferToHex(hash));
              continue;
            }
          }

          {
            const set = this.waitingList.get(hash);
            if (set) {
              set.add(message.origin);
              forceAdd(this.watingSlots, message.origin, hash);
              console.debug('new pooled txs, waitingList has hash', bufferToHex(hash));
              continue;
            }
          }

          forceAdd(this.waitingList, hash, message.origin);
          this.waitingTime.set(hash, Date.now());
          forceAdd(this.watingSlots, message.origin, hash);
          console.debug('new pooled txs, add hash to waiting list', bufferToHex(hash));
        }

        if (idleWait && this.waitingTime.size > 0) {
          this.rescheduleWait();
        }
        const set = this.announces.get(message.origin);
        if (!oldPeer && set && set.size > 0) {
          this.scheduleFetches(
            new Set<string>([message.origin])
          );
        }
      }
    } catch (err) {
      this.emit('error', err);
    }
  }

  private async enqueueTransactionLoop() {
    try {
      for await (const message of this.enqueueTransactionQueue.generator()) {
        console.debug(
          'enqueue transaction',
          message.txs.map((tx) => bufferToHex(tx.hash())),
          'from',
          message.origin
        );
        // TODO: check underpriced and duplicate and etc.
        const added = (await this.node.addPendingTxs(message.txs)).map((result, i) => (result ? message.txs[i] : null)).filter((ele) => ele !== null) as Transaction[];
        console.debug(
          'enqueue transaction, added',
          added.map((tx) => bufferToHex(tx.hash()))
        );
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
            console.debug('enqueue transaction, waitingList has hash', bufferToHex(hash));
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
              if (req) {
                req.stolen = req.stolen ? req.stolen.add(hash) : createBufferFunctionalSet().add(hash);
              }
            }
            this.fetching.delete(hash);
            console.debug("enqueue transaction, waitingList doesn't has hash", bufferToHex(hash));
          }
        }

        const req = this.requests.get(message.origin);
        if (!req) {
          console.warn('TxFetcher, unexpected transaction delivery, peer:', message.origin);
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
                panicError('enqueueTransactionLoop, announced hash existed', bufferToHex(hash));
              }
              this.announced.set(hash, this.alternates.get(hash)!);
            }
          }
          this.alternates.delete(hash);
          this.fetching.delete(hash);
        }
        this.scheduleFetches();
      }
    } catch (err) {
      this.emit('error', err);
    }
  }

  private rescheduleWait() {
    if (this.waitTimeout) {
      clearTimeout(this.waitTimeout);
      this.waitTimeout = undefined;
      console.debug('rescheduleWait clear timeout');
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
    console.debug('rescheduleWait to', txArriveTimeout - (now - earliest), 'seconds later');
    this.waitTimeout = setTimeout(() => {
      console.debug('rescheduleWait timeout');
      const now = Date.now();
      const actives = new Set<string>();
      for (const [hash, instance] of this.waitingTime) {
        if (now - instance + txGatherSlack > txArriveTimeout) {
          if (this.announced.has(hash)) {
            panicError('rescheduleWait, announced hash existed', bufferToHex(hash));
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
        this.scheduleFetches(actives);
      }
    }, txArriveTimeout - (now - earliest));
  }

  private scheduleFetches(whiteList?: Set<string>) {
    const actives = whiteList ? new Set<string>(whiteList) : new Set<string>(this.announces.keys());
    if (actives.size === 0) {
      return;
    }

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
            panicError('scheduleFetches, alternates hash existed', bufferToHex(hash));
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
          this.dropPeer(peer);
        } else {
          console.debug(
            'scheduleFetches, hashes:',
            hashes.map((h) => bufferToHex(h)),
            'to:',
            peer
          );
          p.getPooledTransactions(hashes)
            .then((txs) => {
              this.enqueueTransaction(peer, txs);
            })
            .catch((err) => {
              if (err instanceof PeerRequestTimeoutError) {
                this.requestTimeout(peer);
              } else {
                this.dropPeer(peer);
              }
              this.emit('error', err);
            });
        }
      }
    }
  }

  private requestTimeout(peer: string) {
    const req = this.requests.get(peer);
    if (!req) {
      return;
    }
    console.debug('requestTimeout', peer);

    for (const hash of req.hashes) {
      if (req.stolen && req.stolen.has(hash)) {
        continue;
      }
      if (this.announced.has(hash)) {
        panicError('requestTimeout, announced hash existed', bufferToHex(hash));
      }
      const alters = this.alternates.get(hash);
      if (alters) {
        this.announced.set(hash, alters);
      }
      autoDelete(this.announced, hash, peer);
      this.announces.get(peer)?.delete(hash);
      this.alternates.delete(hash);
      this.fetching.delete(hash);
    }
    if (this.announces.get(peer)?.size === 0) {
      this.announces.delete(peer);
    }
    req.hashes = [];

    this.scheduleFetches();
  }

  dropPeer(peer: string) {
    console.debug('dropPeer', peer);
    {
      const set = this.watingSlots.get(peer);
      if (set) {
        for (const hash of set) {
          this.waitingList.get(hash)?.delete(peer);
          if (this.waitingList.get(hash)?.size === 0) {
            this.waitingList.delete(hash);
            this.waitingTime.delete(hash);
          }
        }
        this.watingSlots.delete(peer);
        if (this.waitingTime.size > 0) {
          this.rescheduleWait();
        }
      }
    }

    const req = this.requests.get(peer);
    if (req) {
      for (const hash of req.hashes) {
        if (req.stolen && req.stolen.has(hash)) {
          continue;
        }
        const alters = this.alternates.get(hash);
        if (alters && alters.size > 0) {
          alters.delete(peer);
          if (alters.size === 0) {
            this.alternates.delete(hash);
          } else {
            this.announced.set(hash, alters);
            this.alternates.delete(hash);
          }
        }
        this.fetching.delete(hash);
      }
      this.requests.delete(peer);
    }

    {
      const set = this.announces.get(peer);
      if (set) {
        for (const hash of set) {
          autoDelete(this.announced, hash, peer);
        }
        this.announces.delete(peer);
      }
    }

    if (req) {
      this.scheduleFetches();
    }
  }

  newPooledTransactionHashes(origin: string, hashes: Buffer[]) {
    if (!this.aborter.isAborted) {
      this.newPooledTransactionQueue.push({ hashes, origin });
    }
  }

  enqueueTransaction(origin: string, txs: Transaction[]) {
    if (!this.aborter.isAborted) {
      this.enqueueTransactionQueue.push({ txs, origin });
    }
  }
}
