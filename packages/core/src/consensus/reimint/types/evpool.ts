import { BN } from 'ethereumjs-util';
import { Evidence } from './evidence';
// import { EvidenceDatabase } from './evdb';

export interface EvidencePoolBackend {
  isCommitted(ev: Evidence): Promise<boolean>;
  isPending(ev: Evidence): Promise<boolean>;
  addPendingEvidence(ev: Evidence): void;
  addCommittedEvidence(ev: Evidence): void;
  removePendingEvidence(ev: Evidence): void;
  loadPendingEvidence(any): Promise<void>;
}

export class EvidencePool {
  private readonly backend: EvidencePoolBackend;
  private initPromise?: Promise<void>;
  // cached evidence for broadcast
  private cachedPendingEvidence: Evidence[] = [];
  private height: BN = new BN(0);
  private pruningHeight: BN = new BN(0);
  private evpoolMaxCacheSize: number;
  private evpoolMaxAgeNumBlocks: BN;

  constructor(backend: EvidencePoolBackend, maxCacheSize?: number, maxAgeNumBlocks?: BN) {
    this.backend = backend;
    this.evpoolMaxCacheSize = maxCacheSize ? maxCacheSize : 100;
    this.evpoolMaxAgeNumBlocks = maxAgeNumBlocks ? maxAgeNumBlocks : new BN(10000);
  }

  get pendingEvidence() {
    return [...this.cachedPendingEvidence];
  }

  private deleteFromCache(ev: Evidence) {
    const index = this.cachedPendingEvidence.findIndex((_ev) => _ev.hash().equals(ev.hash()));
    if (index !== -1) {
      this.cachedPendingEvidence.splice(index, 1);
    }
  }

  private addToCache(ev: Evidence) {
    this.cachedPendingEvidence.push(ev);
    if (this.cachedPendingEvidence.length > this.evpoolMaxCacheSize) {
      this.cachedPendingEvidence.shift();
    }
  }

  private verify(ev: Evidence) {
    return true;
  }

  private async _init(height: BN) {
    try {
      await this.backend.loadPendingEvidence({
        // add 1 because we may have collected evidence for the next block
        to: height.addn(1),
        reverse: true,
        onData: (ev) => {
          this.addToCache(ev);
          return this.cachedPendingEvidence.length >= this.evpoolMaxCacheSize;
        }
      });
      this.height = height.clone();
    } catch (err) {
      this.cachedPendingEvidence = [];
      this.height = new BN(0);
      throw err;
    }
  }

  private _afterInit() {
    if (!this.initPromise) {
      throw new Error('missing init promise');
    }
    return this.initPromise;
  }

  init(height: BN) {
    return this.initPromise ?? (this.initPromise = this._init(height));
  }

  /**
   * Add a pending evidence to cache and database,
   * it will be called from p2p network or local state machine
   * @param ev - Pending evidence
   */
  async addEvidence(ev: Evidence) {
    await this._afterInit();
    await this.backend.addPendingEvidence(ev);
    this.addToCache(ev);
  }

  /**
   * Pick evidence that occurred before the target height from the database
   * @param height - Target height
   * @param count - Pick count
   * @returns Evidence list
   */
  async pickEvidence(height: BN, count: number) {
    const evList: Evidence[] = [];
    const from = height.gt(this.evpoolMaxAgeNumBlocks) ? height.sub(this.evpoolMaxAgeNumBlocks) : new BN(0);
    const to = height.subn(1);
    try {
      await this.backend.loadPendingEvidence({
        from,
        to,
        onData: (ev) => {
          evList.push(ev);
          return evList.length >= count;
        }
      });
    } catch (err) {
      // ignore all errors
    }
    return evList;
  }

  private async pruneExpiredPendingEvidence() {
    const evList: Evidence[] = [];
    try {
      await this.backend.loadPendingEvidence({
        from: new BN(0),
        onData: (ev) => {
          evList.push(ev);
          return this.height.sub(ev.height).lt(this.evpoolMaxAgeNumBlocks);
        }
      });
      if (evList.length > 0) {
        evList.pop();
      }
      const promiseList = evList.map((ev) => {
        this.deleteFromCache(ev);
        this.backend.removePendingEvidence(ev);
      });
      await Promise.all(promiseList);
      if (evList.length > 0) {
        this.pruningHeight = evList[evList.length - 1].height;
      }
    } catch (err) {
      throw err;
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
      throw new Error('failed EvidencePool.Update new height is less than or equal to previous height: ' + height + '<=' + this.height);
    }
    try {
      this.height = height;

      for (let i = 0; i < committedEvList.length; i++) {
        // save committed evidences
        if (!(await this.backend.isCommitted(committedEvList[i]))) {
          await this.backend.addCommittedEvidence(committedEvList[i]);
        }

        if (await this.backend.isPending(committedEvList[i])) {
          // mark pending evidences as committed
          await this.backend.removePendingEvidence(committedEvList[i]);
          // remove committed evidences from this.cachedPendingEvidence
          this.deleteFromCache(committedEvList[i]);
        }
      }
      // this.pruneExpiredPendingEvidences
      if (this.height > this.pruningHeight) {
        await this.pruneExpiredPendingEvidence();
      }
    } catch (err) {
      throw err;
    }
  }
}
