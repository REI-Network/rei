/**
 * A simple count lock,
 * when the count reaches 0, the lock will be released
 */
export class CountLock {
  private lock?: Promise<void>;
  private resolve?: () => void;
  private _count = 0;

  get count() {
    return this._count;
  }

  /**
   * Increase count
   * @param count - Count number
   */
  increase(count = 1) {
    if (this._count === 0) {
      this.lock = new Promise((r) => {
        this.resolve = r;
      });
    }

    this._count += count;
  }

  /**
   * Decrease count
   * @param count - Count number
   */
  decrease(count = 1) {
    if (this._count - count < 0) {
      throw new Error('invalid decrease');
    }

    this._count -= count;

    if (this._count === 0 && this.resolve) {
      this.resolve();
      this.resolve = undefined;
      this.lock = undefined;
    }
  }

  /**
   * Wait until the count reaches 0
   */
  wait() {
    return this.lock ?? Promise.resolve();
  }
}
