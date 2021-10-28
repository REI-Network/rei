import { BN } from 'ethereumjs-util';
import { BlockHeader } from '@gxchain2/structure';
import { Evidence } from './evidence';
import { EvidenceDatabase } from './evdb';

const EVPOOL_MAX_CACHE_SIZE = 100;

export class EvidencePool {
  private readonly db: EvidenceDatabase;
  private readonly initPromise: Promise<void>;
  // cached evidence for broadcast
  private cachedPendingEvidence: Evidence[] = [];

  constructor(db: EvidenceDatabase) {
    this.db = db;
    this.initPromise = this.init();
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

  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    // load pending evidences from database
  }

  addEvidence(ev: Evidence) {
    // save pending evidence
    // add pending evidence to this.cachedPendingEvidence
  }

  pickEvidence(height: BN, count: number): Evidence[] {
    // pick from db
    return [];
  }

  private pruneExpiredPendingEvidence() {
    // delete from db
    // delete from this.cachedPendingEvidence
  }

  async newBlockHeader(header: BlockHeader) {
    // save committed evidence
    // mark pending evidences as committed
    // remove committed evidences from this.cachedPendingEvidence
    // this.pruneExpiredPendingEvidences
  }
}
