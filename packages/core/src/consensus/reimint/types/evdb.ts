import { LevelUp } from 'levelup';
import { AbstractIterator } from 'abstract-leveldown';
import { intToBuffer, toBuffer, BN } from 'ethereumjs-util';
import { Evidence, EvidenceFactory } from './evidence';
import { EMPTY_HASH } from '../../utils';

const PENDING_PREFIX = 1;
const COMMITED_PREFIX = 2;
const MAX_HASH = Buffer.from(new Uint8Array(32).fill(0xff));

function emptyKeyPending(height: BN) {
  return Buffer.concat([intToBuffer(PENDING_PREFIX), toBuffer(height), EMPTY_HASH]);
}

function maxKeyPending(height: BN) {
  return Buffer.concat([intToBuffer(PENDING_PREFIX), toBuffer(height), MAX_HASH]);
}

function keyPending(ev: Evidence) {
  return Buffer.concat([intToBuffer(PENDING_PREFIX), toBuffer(ev.height), ev.hash()]);
}

function keyCommitted(ev: Evidence) {
  return Buffer.concat([intToBuffer(COMMITED_PREFIX), toBuffer(ev.height), ev.hash()]);
}

export class EvidenceDatabase {
  private readonly db: LevelUp;

  constructor(db: LevelUp) {
    this.db = db;
  }

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

  addPendingEvidence(ev: Evidence) {
    return this.db.put(keyPending(ev), ev.serialize());
  }

  removePendingEvidence(ev: Evidence) {
    return this.db.del(keyPending(ev), ev.serialize());
  }

  addCommittedEvidence(ev: Evidence) {
    return this.db.put(keyCommitted(ev), ev.serialize());
  }

  VerifyDuplicateVote(ev: Evidence) {
    const duplicateVoteEvidence = EvidenceFactory.fromSerializedEvidence(ev.serialize());
    const voteA = duplicateVoteEvidence.voteA;
    const voteB = duplicateVoteEvidence.voteB;
    if (!voteA.height.eq(voteB.height) || voteA.round !== voteB.round || voteA.type !== voteB.type || voteA.chainId !== voteB.chainId || !voteA.validator().equals(voteB.validator())) {
      return false;
    }
    return true;
  }
  /**
   * Load pending evidence from database
   * @param from - The height at which to start the search
   * @param to - The height at which to end the search
   * @param reverse - Set to true if you want the stream to go in reverse order
   * @param onData - Data callback, return true to break the search loop
   */
  async loadPendingEvidence({ from, to, reverse, onData }: { from?: BN; to?: BN; reverse?: boolean; onData: (data: Evidence) => boolean }) {
    const itr: AbstractIterator<Buffer, Buffer> = this.db.iterator({
      gte: from ? emptyKeyPending(from) : undefined,
      lte: to ? maxKeyPending(to) : undefined,
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
      while ((serialized = await next()) && !onData(EvidenceFactory.fromSerializedEvidence(serialized))) {}
    } catch (err) {
      throw err;
    } finally {
      await close();
    }
  }
}
