import { keccak256 } from 'ethereumjs-util';
import { FunctionalBufferSet } from '@rei-network/utils';
import { Database, DBOp } from '@rei-network/database';
import { SnapIterator } from './types';
import { DBatch } from './batch';

export class SimpleAborter {
  private aborted = false;
  private promise?: Promise<void>;
  private resolve?: () => void;
  private reject?: (reason?: any) => void;

  get isAborted() {
    return this.aborted;
  }

  /**
   * Abort
   * @returns A promise
   */
  abort() {
    this.aborted = true;
    return (
      this.promise ??
      (this.promise = new Promise<void>((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
      }))
    );
  }

  /**
   * Reset aborter
   */
  reset() {
    if (this.promise || this.resolve || this.reject) {
      throw new Error('invalid reset');
    }

    this.aborted = false;
  }

  /**
   * Tell the aborter that the task was aborted
   * @param reason - Abort reason
   */
  abortFinished(reason?: any) {
    if (this.promise && this.resolve && this.reject) {
      reason ? this.resolve() : this.reject(reason);
      this.resolve = undefined;
      this.reject = undefined;
      this.promise = undefined;
    }
  }
}

/**
 * Increase the buffer from the last bit, without changing the original value
 * @param key - Buffer
 * @returns Increased buffer or null
 */
export function increaseKey(key: Buffer) {
  const lastItem: number[] = [];
  let increased = false;
  for (let i = key.length - 1; i >= 0; i--) {
    if (key[i] === 0xff) {
      lastItem.push(0);
      continue;
    } else {
      lastItem.push(key[i] + 1);
      increased = true;
      break;
    }
  }

  if (!increased) {
    return null;
  }

  return Buffer.concat([key.slice(0, key.length - lastItem.length), Buffer.from(lastItem.reverse())]);
}

/**
 * Merge all proofs
 * @param proof1
 * @param proof2
 * @returns Merged proof
 */
export function mergeProof(proof1: Buffer[], proof2: Buffer[]) {
  const proof: Buffer[] = [];
  const set = new FunctionalBufferSet();
  for (const p of proof1) {
    proof.push(p);
    set.add(keccak256(p));
  }
  for (const p of proof2) {
    if (!set.has(keccak256(p))) {
      proof.push(p);
    }
  }
  return proof;
}

/**
 * wipeKeyRange will delete all values between `origin` and `limit`
 * @param db - Database object
 * @param origin - Origin
 * @param limit - Limit
 * @param genItrator - A function that generates an iterator
 * @param genDBOp - A function that generates an operator for each value
 */
export async function wipeKeyRange<T>(db: Database, origin: Buffer, limit: Buffer, genItrator: (origin: Buffer, limit: Buffer) => SnapIterator<T>, genDBOp: (hash: Buffer) => DBOp) {
  const batch = new DBatch(db);
  while (true) {
    let _continue = false;
    for await (const { hash } of genItrator(origin, limit)) {
      batch.push(genDBOp(hash));

      if (batch.length % 10000 === 0) {
        // batch too large (or iterator too long lived, flush and recreate)
        origin = hash;
        _continue = true;
        break;
      }
    }

    if (batch.length > 0) {
      await batch.write();
      batch.reset();
    }

    if (!_continue) {
      break;
    }
  }
}
