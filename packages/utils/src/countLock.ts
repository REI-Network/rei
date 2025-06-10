/**
 * A simple count lock,
 * when the count reaches 0, the lock will be released
 */
export class CountLock {
  private lock?: Promise<void>;
  private resolve?: () => void;
  private count = 0;

  /**
   * Increase count
   * @param count - Count number
   */
  increase(count = 1) {
    if (this.count === 0) {
      this.lock = new Promise((r) => {
        this.resolve = r;
      });
    }

    this.count += count;
  }

  /**
   * Decrease count
   * @param count - Count number
   */
  decrease(count = 1) {
    if (this.count - count < 0) {
      throw new Error('invalid decrease');
    }

    this.count -= count;

    if (this.count === 0 && this.resolve) {
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
