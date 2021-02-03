import Semaphore from 'semaphore-async-await';

export class SemaphoreLock<T = any> {
  private readonly _lock = new Semaphore(1);
  private readonly compare: (a: T, b: T) => number;
  private bestKey?: T;

  constructor(compare: (a: T, b: T) => number) {
    this.compare = compare;
  }

  async compareLock(key: T) {
    if (!this.bestKey || this.compare(this.bestKey, key) === -1) {
      this.bestKey = key;
    } else {
      return false;
    }
    await this._lock.acquire();
    if (this.compare(this.bestKey, key) !== 0) {
      this._lock.release();
      return false;
    }
    return true;
  }

  lock() {
    return this._lock.acquire();
  }

  release() {
    this._lock.release();
  }
}
