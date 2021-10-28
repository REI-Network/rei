import { BN } from 'ethereumjs-util';
import { BlockHeader } from '@gxchain2/structure';
import { ExtraData } from './extraData';
import { Evidence } from './evidence';
import { EvidenceDatabase } from './evdb';

const EVPOOL_MAX_CACHE_SIZE = 100;
const EVPOOL_MAX_AGE_NUM_BLOCKS = new BN(10000);

export class EvidencePool {
  private readonly db: EvidenceDatabase;
  private initPromise?: Promise<void>;
  // cached evidence for broadcast
  private cachedPendingEvidence: Evidence[] = [];
  private height: BN = new BN(0);

  constructor(db: EvidenceDatabase) {
    this.db = db;
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
    if (this.cachedPendingEvidence.length > EVPOOL_MAX_CACHE_SIZE) {
      this.cachedPendingEvidence.shift();
    }
  }

  private verify(ev: Evidence) {
    return true;
  }

  private async _init(height: BN) {
    try {
      await this.db.loadPendingEvidence({
        // add 1 because we may have collected evidence for the next block
        to: height.addn(1),
        reverse: true,
        onData: (ev) => {
          this.addToCache(ev);
          return this.cachedPendingEvidence.length >= EVPOOL_MAX_CACHE_SIZE;
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
    await this.db.addPendingEvidence(ev);
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
    const from = height.gt(EVPOOL_MAX_AGE_NUM_BLOCKS) ? height.sub(EVPOOL_MAX_AGE_NUM_BLOCKS) : new BN(0);
    const to = height.subn(1);
    try {
      await this.db.loadPendingEvidence({
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

  private pruneExpiredPendingEvidence() {
    // delete from db
    // delete from this.cachedPendingEvidence
  }

  async newBlockHeader(header: BlockHeader) {
    const extraData = ExtraData.fromBlockHeader(header);
    const evidence = extraData.evidence;
    // save committed evidence
    // mark pending evidences as committed
    // remove committed evidences from this.cachedPendingEvidence
    // this.pruneExpiredPendingEvidences
  }
}
