import Semaphore from 'semaphore-async-await';
import { BN } from 'ethereumjs-util';
import { Initializer } from '@rei-network/utils';
import { Evidence } from './evidence';

const defaultMaxCacheSize = 100;
const defaultMaxAgeNumBlocks = new BN(10000);

export interface EvidencePoolBackend {
  isCommitted(ev: Evidence): Promise<boolean>;
  isPending(ev: Evidence): Promise<boolean>;
  addPendingEvidence(ev: Evidence): Promise<void>;
  addCommittedEvidence(ev: Evidence): Promise<void>;
  removePendingEvidence(ev: Evidence): Promise<void>;
  loadPendingEvidence({ from, to, reverse, onData }: { from?: BN; to?: BN; reverse?: boolean; onData: (data: Evidence) => Promise<boolean> }): Promise<void>;
}

export interface EvidencePoolOptions {
  backend: EvidencePoolBackend;
  maxCacheSize?: number;
  maxAgeNumBlocks?: BN;
}

export class EvidencePool extends Initializer {
  private readonly backend: EvidencePoolBackend;
  private readonly lock = new Semaphore(1);
  private readonly maxCacheSize: number;
  private readonly maxAgeNumBlocks: BN;
  // cached evidence for broadcast
  private cachedPendingEvidence: Evidence[] = [];
  private height: BN = new BN(0);
  private pruningHeight: BN = new BN(0);

  constructor({ backend, maxCacheSize, maxAgeNumBlocks }: EvidencePoolOptions) {
    super();
    this.backend = backend;
    this.maxCacheSize = maxCacheSize ?? defaultMaxCacheSize;
    this.maxAgeNumBlocks = maxAgeNumBlocks ?? defaultMaxAgeNumBlocks;
  }

  get pendingEvidence() {
    return [...this.cachedPendingEvidence];
  }

  private async runWithLock<T>(fn: () => Promise<T>) {
    try {
      await this.lock.acquire();
      return await fn();
    } catch (err) {
      throw err;
    } finally {
      this.lock.release();
    }
  }

  private deleteFromCache(ev: Evidence) {
    const index = this.cachedPendingEvidence.findIndex((_ev) => _ev.hash().equals(ev.hash()));
    if (index !== -1) {
      this.cachedPendingEvidence.splice(index, 1);
    }
  }

  private addToCache(ev: Evidence) {
    // check repeated evidence
    for (const _ev of this.cachedPendingEvidence) {
      if (ev.hash().equals(_ev.hash())) {
        return;
      }
    }

    // push to cache
    this.cachedPendingEvidence.push(ev);
    if (this.cachedPendingEvidence.length > this.maxCacheSize) {
      this.cachedPendingEvidence.shift();
    }
  }

  /**
   * Initialize evidence pool from the target height
   * @param height - Target height
   */
  async init(height: BN) {
    try {
      await this.runWithLock(async () => {
        this.height = height.clone();
        await this.pruneExpiredPendingEvidence();
        await this.backend.loadPendingEvidence({
          // add 1 because we may have collected evidence for the next block
          to: height.addn(1),
          reverse: true,
          onData: async (ev) => {
            this.addToCache(ev);
            return this.cachedPendingEvidence.length >= this.maxCacheSize;
          }
        });
        this.initOver();
      });
    } catch (err) {
      this.cachedPendingEvidence = [];
      this.height = new BN(0);
      throw err;
    }
  }

  /**
   * Add a pending evidence to cache and database,
   * it will be called from p2p network or local state machine
   * @param ev - Pending evidence
   */
  async addEvidence(ev: Evidence) {
    await this.initPromise;
    return await this.runWithLock(async () => {
      if (this.isExpired(ev)) {
        return false;
      }
      if (await this.backend.isPending(ev)) {
        return false;
      }
      if (await this.backend.isCommitted(ev)) {
        return false;
      }
      await this.backend.addPendingEvidence(ev);
      this.addToCache(ev);
      return true;
    });
  }

  /**
   * Pick evidence that occurred before the target height from the database
   * @param height - Target height
   * @param count - Pick count
   * @returns Evidence list
   */
  async pickEvidence(height: BN, count: number) {
    if (height.eqn(0)) {
      throw new Error('invalid height');
    } else if (height.eqn(1)) {
      return [];
    }

    await this.initPromise;
    return await this.runWithLock(async () => {
      const evList: Evidence[] = [];
      const from = height.gt(this.maxAgeNumBlocks) ? height.sub(this.maxAgeNumBlocks) : new BN(0);
      const to = height.subn(1);
      try {
        await this.backend.loadPendingEvidence({
          from,
          to,
          onData: async (ev) => {
            evList.push(ev);
            return evList.length >= count;
          }
        });
      } catch (err) {
        // ignore all errors
      }
      return evList;
    });
  }

  /**
   * Determine if evidence is expired
   * @param ev - Evidence
   * @param height - Local height(default: this.height)
   * @returns Is expired
   */
  isExpired(ev: Evidence, height?: BN) {
    return (height ?? this.height).sub(ev.height).gte(this.maxAgeNumBlocks);
  }

  private async pruneExpiredPendingEvidence() {
    let notExpiredEv: Evidence | undefined;
    await this.backend.loadPendingEvidence({
      from: new BN(0),
      onData: async (ev: Evidence) => {
        const isExpired = this.isExpired(ev);
        if (!isExpired) {
          notExpiredEv = ev;
        } else {
          await this.backend.removePendingEvidence(ev);
          this.deleteFromCache(ev);
        }
        return !isExpired;
      }
    });

    if (notExpiredEv) {
      this.pruningHeight = notExpiredEv.height.add(this.maxAgeNumBlocks);
    } else {
      this.pruningHeight = this.height.clone();
    }
  }

  /**
   * Update evidence state, it will be called
   * when a new block is minted
   * @param committedEvList - Committed evidence contained in the block
   * @param height - Block height
   */
  async update(committedEvList: Evidence[], height: BN) {
    if (height.lte(this.height)) {
      throw new Error('failed EvidencePool.Update new height is less than or equal to previous height: ' + height.toNumber() + '<=' + this.height.toNumber());
    }

    await this.initPromise;
    await this.runWithLock(async () => {
      this.height = height.clone();

      for (const ev of committedEvList) {
        // save committed evidence
        if (!(await this.backend.isCommitted(ev))) {
          await this.backend.addCommittedEvidence(ev);
          await this.backend.removePendingEvidence(ev);
          this.deleteFromCache(ev);
        }
      }

      if (this.height.gte(this.pruningHeight)) {
        await this.pruneExpiredPendingEvidence();
      }
    });
  }

  /**
   * CheckEvidence takes an array of evidence from a block and verifies all the evidence there
   * @param evList - List of evidence
   */
  async checkEvidence(evList: Evidence[]) {
    await this.initPromise;
    return await this.runWithLock(async () => {
      const hashes = new Array<Buffer>(evList.length);
      for (let i = 0; i < evList.length; i++) {
        const ev = evList[i];

        if (this.isExpired(ev)) {
          throw new Error('expired evidence');
        }

        if (ev.height.gt(this.height)) {
          throw new Error('future evidence');
        }

        if (await this.backend.isCommitted(ev)) {
          throw new Error('committed evidence');
        }

        if (!(await this.backend.isPending(ev))) {
          await this.backend.addPendingEvidence(ev);
          this.addToCache(ev);
        }

        // check for hash conflicts
        hashes[i] = ev.hash();
        for (let j = i - 1; j >= 0; j--) {
          if (hashes[i].equals(hashes[j])) {
            throw new Error('repeated evidence');
          }
        }
      }
    });
  }
}
