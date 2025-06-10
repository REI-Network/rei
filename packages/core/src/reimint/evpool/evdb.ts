import { LevelUp } from 'levelup';
import { AbstractIterator } from 'abstract-leveldown';
import { intToBuffer, BN } from 'ethereumjs-util';
import { EvidenceFactory } from './evidenceFactory';
import { Evidence } from './evidence';
import { EMPTY_HASH } from '../../utils';

const PENDING_PREFIX = 1;
const COMMITED_PREFIX = 2;
const MAX_HASH = Buffer.from(new Uint8Array(32).fill(0xff));
const MAX_UINT64 = new BN('ffffffffffffffff', 'hex');

/**
 * Append an empty key for pending evidence
 * @param height - Target height
 * @returns Pending key
 */
function emptyKeyPending(height: BN) {
  const heightBuffer = Buffer.alloc(8);
  heightBuffer.writeBigUInt64BE(BigInt(height.toString()));
  return Buffer.concat([intToBuffer(PENDING_PREFIX), heightBuffer, EMPTY_HASH]);
}

/**
 * Append a max key for pending evidence
 * @param height - Target height
 * @returns Pending key
 */
function maxKeyPending(height: BN) {
  const heightBuffer = Buffer.alloc(8);
  heightBuffer.writeBigUInt64BE(BigInt(height.toString()));
  return Buffer.concat([intToBuffer(PENDING_PREFIX), heightBuffer, MAX_HASH]);
}

/**
 * Append a key for pending evidence
 * @param ev - Evidence
 * @returns Pending key
 */
function keyPending(ev: Evidence) {
  const heightBuffer = Buffer.alloc(8);
  heightBuffer.writeBigUInt64BE(BigInt(ev.height.toString()));
  return Buffer.concat([intToBuffer(PENDING_PREFIX), heightBuffer, ev.hash()]);
}

/**
 * Append a key for committed evidence
 * @param ev - Evidence
 * @returns Committed key
 */
function keyCommitted(ev: Evidence) {
  const heightBuffer = Buffer.alloc(8);
  heightBuffer.writeBigUInt64BE(BigInt(ev.height.toString()));
  return Buffer.concat([intToBuffer(COMMITED_PREFIX), heightBuffer, ev.hash()]);
}

export class EvidenceDatabase {
  private readonly db: LevelUp;

  constructor(db: LevelUp) {
    this.db = db;
  }

  /**
   * Check whether the evidence is pending
   * @param ev - Evidence
   * @returns Return true if it is pending
   */
  async isPending(ev: Evidence) {
    try {
      await this.db.get(keyPending(ev));
      return true;
    } catch (err: any) {
      if (err.type === 'NotFoundError') {
        return false;
      }
      throw err;
    }
  }

  /**
   * Check whether the evidence is committed
   * @param ev - Evidence
   * @returns Return true if it is committed
   */
  async isCommitted(ev: Evidence) {
    try {
      await this.db.get(keyCommitted(ev));
      return true;
    } catch (err: any) {
      if (err.type === 'NotFoundError') {
        return false;
      }
      throw err;
    }
  }

  /**
   * Add a pending evidence to database
   * @param ev - Evidence
   */
  addPendingEvidence(ev: Evidence) {
    return this.db.put(keyPending(ev), EvidenceFactory.serializeEvidence(ev));
  }

  /**
   * Remove a pending evidence from database
   * @param ev - Evidence
   */
  removePendingEvidence(ev: Evidence) {
    return this.db.del(keyPending(ev));
  }

  /**
   * Add a committed evidence to database
   * @param ev - Evidence
   */
  addCommittedEvidence(ev: Evidence) {
    return this.db.put(keyCommitted(ev), EvidenceFactory.serializeEvidence(ev));
  }

  /**
   * Load pending evidence from database
   * @param from - The height at which to start the search
   * @param to - The height at which to end the search
   * @param reverse - Set to true if you want the stream to go in reverse order
   * @param onData - Data callback, return true to break the search loop
   */
  async loadPendingEvidence({
    from,
    to,
    reverse,
    onData
  }: {
    from?: BN;
    to?: BN;
    reverse?: boolean;
    onData: (data: Evidence) => Promise<boolean>;
  }) {
    const itr: AbstractIterator<Buffer, Buffer> = this.db.iterator({
      gte: emptyKeyPending(from ?? new BN(0)),
      lte: maxKeyPending(to ?? MAX_UINT64),
      reverse
    });
    const next = () => {
      return new Promise<Buffer | undefined>((resolve, reject) => {
        itr.next((err, k, v) => {
          if (err) {
            reject(err);
          } else {
            resolve(v);
          }
        });
      });
    };
    const close = () => {
      return new Promise<void>((resolve, reject) => {
        itr.end((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    };

    try {
      let serialized: Buffer | undefined;
      while (
        (serialized = await next()) &&
        !(await onData(EvidenceFactory.fromSerializedEvidence(serialized)))
      ) {}
    } finally {
      await close();
    }
  }
}
