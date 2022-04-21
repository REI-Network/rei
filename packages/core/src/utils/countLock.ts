export class CountLock {
  private lock?: Promise<void>;
  private resolve?: () => void;
  private count: number = 0;

  increase(count: number = 1) {
    if (this.count === 0) {
      this.lock = new Promise((r) => {
        this.resolve = r;
      });
    }

    this.count += count;
  }

  decrease(count: number = 1) {
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

  wait() {
    return this.lock ?? Promise.resolve();
  }
}
