import { BN } from 'ethereumjs-util';
import { DuplicateVoteEvidence, Evidence } from './evidence';
import { logger } from '@gxchain2/utils';

export interface EvidencePoolBackend {
  isCommitted(ev: Evidence): Promise<boolean>;
  isPending(ev: Evidence): Promise<boolean>;
  addPendingEvidence(ev: Evidence): Promise<void>;
  addCommittedEvidence(ev: Evidence): Promise<void>;
  removePendingEvidence(ev: Evidence): Promise<void>;
  loadPendingEvidence({ from, to, reverse, onData }: { from?: BN; to?: BN; reverse?: boolean; onData: (data: Evidence) => boolean }): Promise<void>;
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
    const blockAge = this.height.sub(ev.height);
    if (blockAge.gt(this.evpoolMaxAgeNumBlocks)) {
      return false;
    }
    if (ev instanceof DuplicateVoteEvidence) {
      if (!ev.voteA.height.eq(ev.voteB.height) || ev.voteA.round !== ev.voteB.round || ev.voteA.type !== ev.voteB.type || ev.voteA.chainId !== ev.voteB.chainId || !ev.voteA.validator().equals(ev.voteB.validator())) {
        return false;
      }
    } else {
      return false;
    }
    return true;
  }

  private async _init(height: BN) {
    try {
      await this.pruneExpiredPendingEvidence();
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
    if (await this.backend.isPending(ev)) {
      logger.info('evidence already pending; ignoring', 'evidence', ev);
      return;
    }
    if (await this.backend.isCommitted(ev)) {
      logger.info('evidence was already committed; ignoring', 'evidence', ev);
      return;
    }
    if (!this.verify(ev)) {
      throw new Error('the evidence can not pass verify');
    }
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
    let crossedEv: Evidence | undefined = undefined;
    await this.backend.loadPendingEvidence({
      from: new BN(0),
      onData: (ev: Evidence) => {
        const crossed = this.height.sub(ev.height).lt(this.evpoolMaxAgeNumBlocks);
        if (!crossed) {
          evList.push(ev);
        } else {
          crossedEv = ev;
        }
        return crossed;
      }
    });

    if (evList.length > 0) {
      await Promise.all(
        evList.map((ev) => {
          this.deleteFromCache(ev);
          return this.backend.removePendingEvidence(ev);
        })
      );
    }
    if (crossedEv) {
      this.pruningHeight = (crossedEv as Evidence).height.add(this.evpoolMaxAgeNumBlocks).addn(1);
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
      throw new Error('failed EvidencePool.Update new height is less than or equal to previous height: ' + height.toNumber() + '<=' + this.height.clone().toNumber());
    }

    this.height = height.clone();

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
    if (this.height.gt(this.pruningHeight)) {
      await this.pruneExpiredPendingEvidence();
    }
  }

  /**
   * CheckEvidence takes an array of evidence from a block and verifies all the evidence there
   * @param evList Evidences to check
   * @returns true if all evidence pass check
   */
  async checkEvidence(evList: Evidence[]) {
    const hashes = new Array<Buffer>(evList.length);
    for (let i = 0; i < evList.length; i++) {
      if (!(await this.backend.isPending(evList[i]))) {
        if (await this.backend.isCommitted(evList[i])) {
          return false;
        }
        if (!this.verify(evList[i])) {
          return false;
        }
        await this.backend.addPendingEvidence(evList[i]);
      }
      hashes[i] = evList[i].hash();
      for (let j = i - 1; j >= 0; j--) {
        if (hashes[i].equals(hashes[j])) {
          return false;
        }
      }
    }
    return true;
  }
}
