import { CountLock } from './countLock';

const defaultMaxReadQueue = 100;
const defaultReadTimeout = 5000;

/**
 * Helper class for read-write lock
 */
export class RWLockHelper {
  constructor(private resolve?: () => void) {}

  /**
   * Release the lock
   */
  release() {
    this.resolve?.();
    this.resolve = undefined;
  }
}

/**
 * A read-write lock implementation
 */
export class RWLock {
  private ticking?: Promise<void>;
  private readingCount = new CountLock();
  private readQueue: (() => void)[] = [];
  private writeQueue: (() => Promise<void>)[] = [];

  /**
   * @param maxReadQueue - the max number of read queue,
   *                       if the read queue is full,
   *                       the new read will be rejected
   */
  constructor(private maxReadQueue = defaultMaxReadQueue) {}

  // tick is used to schedule the read and write queue
  private tick() {
    if (this.ticking) {
      return;
    }
    this.ticking = this._tick().finally(() => {
      this.ticking = undefined;
      if (this.readQueue.length > 0 || this.writeQueue.length > 0) {
        this.tick();
      }
    });
  }

  private async _tick() {
    const writeFn = this.writeQueue.shift();
    if (writeFn) {
      await this.readingCount.wait();
      await writeFn();
      return;
    }

    if (this.readQueue.length > 0) {
      this.readQueue.forEach((fn) => fn());
      this.readQueue = [];
    }
  }

  /**
   * Acquire a read lock for the function
   * @param fn - the function to be executed
   * @param timeout - the timeout of the read,
   *                  if the read is not executed within the timeout,
   *                  the read will be rejected
   * @returns the result of the function
   */
  async runWithReadLock<T>(
    fn: () => Promise<T>,
    timeout = defaultReadTimeout
  ): Promise<T> {
    if (this.readQueue.length === this.maxReadQueue) {
      // reach the threshold, throw error
      return Promise.reject(new Error('read queue is full'));
    }

    const promise = new Promise<T>((resolve, reject) => {
      const _fn = () => {
        clearTimeout(_timeout);
        this.readingCount.increase();
        fn()
          .then(resolve)
          .catch(reject)
          .finally(() => this.readingCount.decrease());
      };

      const _timeout = setTimeout(() => {
        let index = this.readQueue.indexOf(_fn);
        if (index !== -1) {
          this.readQueue.splice(index, 1);
          reject(new Error('read timeout'));
        }
      }, timeout);

      this.readQueue.push(_fn);
    });

    // schedule the tick
    this.tick();

    return promise;
  }

  /**
   * Acquire a write lock for the function
   * @param fn - the function to be executed
   * @returns the result of the function
   */
  async runWithWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const promise = new Promise<T>((resolve, reject) => {
      this.writeQueue.push(() => {
        return fn().then(resolve).catch(reject);
      });
    });

    // schedule the tick
    this.tick();

    return promise;
  }

  /**
   * Acquire a read lock
   * @param timeout - the timeout of the read,
   *                  if the read is not executed within the timeout,
   *                  the read will be rejected
   * @returns the helper of the read lock
   */
  async acquireReadLock(timeout = defaultReadTimeout): Promise<RWLockHelper> {
    return new Promise((resolve) => {
      this.runWithReadLock(
        () =>
          new Promise<void>((_resolve) => resolve(new RWLockHelper(_resolve))),
        timeout
      );
    });
  }

  /**
   * Acquire a write lock
   * @returns the helper of the write lock
   */
  async acquireWriteLock(): Promise<RWLockHelper> {
    return new Promise((resolve) => {
      this.runWithWriteLock(
        () =>
          new Promise<void>((_resolve) => resolve(new RWLockHelper(_resolve)))
      );
    });
  }
}
