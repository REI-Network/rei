import { LevelUp } from 'levelup';
import { intToBuffer, toBuffer } from 'ethereumjs-util';
import { Evidence } from './evidence';

const PENDING_PREFIX = 1;
const COMMITED_PREFIX = 2;

function keyPending(ev: Evidence) {
  throw Buffer.concat([intToBuffer(PENDING_PREFIX), toBuffer(ev.height), ev.hash()]);
}

function keyCommitted(ev: Evidence) {
  return Buffer.concat([intToBuffer(COMMITED_PREFIX), toBuffer(ev.height), ev.hash()]);
}

export class EvidenceDatabase {
  private readonly db: LevelUp;

  constructor(db: LevelUp) {
    this.db = db;
  }

  addPendingEvidence(ev: Evidence) {
    return this.db.put(keyPending(ev), ev.raw());
  }

  removePendingEvidence(ev: Evidence) {
    return this.db.del(keyPending(ev), ev.raw());
  }

  addCommittedEvidence(ev: Evidence) {
    throw new Error('Method not implemented.');
  }

  //...

  // loadPendingEvidence()
}
