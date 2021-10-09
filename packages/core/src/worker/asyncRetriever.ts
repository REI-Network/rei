import { BN } from 'ethereumjs-util';
import { TimeoutQueue, createBufferFunctionalMap, createBNFunctionalMap } from '@gxchain2/utils';

export type RetrieveReq<V> = {
  resolve(v: V): void;
  reject(reason?: any): void;
  timeout: number;
};

export abstract class AsyncRetriever<K, V> {
  private timeoutQueue: TimeoutQueue;
  private maxCacheSize: number;
  private cache: [K, V][] = [];
  private reqQueue: Map<K, RetrieveReq<V>[]>;

  /**
   * Compare a and b, return `true` if they are equal.
   * Implement by child class.
   * @param a
   * @param b
   */
  protected abstract kEqual(a: K, b: K): boolean;
  /**
   * Create request queue
   * Implement by child class.
   */
  protected abstract createReqQueue(): Map<K, RetrieveReq<V>[]>;

  constructor(maxCacheSize: number, duration: number) {
    if (maxCacheSize < 1 || duration < 1) {
      throw new Error('AsyncGetter, invalid size or duration');
    }
    this.timeoutQueue = new TimeoutQueue(duration);
    this.maxCacheSize = maxCacheSize;
    this.reqQueue = this.createReqQueue();
  }

  /**
   * Retrieve value by key.
   * If the target key doesn't currently exist in `this.cache`,
   * it will create a `Promise` and waiting until it times out or finds the key
   * @param k - Target key.
   * @returns Value.
   */
  retrieve(k: K) {
    for (const [_k, _v] of this.cache) {
      if (this.kEqual(k, _k)) {
        return Promise.resolve(_v);
      }
    }
    return new Promise<V>((resolve, reject) => {
      const getter: RetrieveReq<V> = {
        resolve,
        reject,
        timeout: this.timeoutQueue.setTimeout(() => {
          reject(new Error('AsyncGetter timeout'));
          const reqList = this.reqQueue.get(k);
          if (reqList) {
            const index = reqList.indexOf(getter);
            if (index !== -1) {
              reqList.splice(index, 1);
              if (reqList.length === 0) {
                this.reqQueue.delete(k);
              }
            }
          }
        })
      };
      const reqList = this.reqQueue.get(k);
      if (!reqList) {
        this.reqQueue.set(k, [getter]);
      } else {
        reqList.push(getter);
      }
    });
  }

  directlyRetrieve(k: K) {
    for (const [_k, _v] of this.cache) {
      if (this.kEqual(k, _k)) {
        return _v;
      }
    }
  }

  /**
   * Push a new value to the cache.
   * If the key currently exists in `this.cache`, it will update the value,
   * Otherwise, it will create a new element to hold the key and the value
   * @param k - Target key
   * @param v - Target value
   */
  push(k: K, v: V) {
    if (!this.update(k, v)) {
      this.cache.push([k, v]);
      while (this.cache.length > this.maxCacheSize) {
        this.cache.shift();
      }
    }

    const reqList = this.reqQueue.get(k);
    if (reqList) {
      for (const { resolve, timeout } of reqList) {
        resolve(v);
        this.timeoutQueue.clearTimeout(timeout);
      }
      this.reqQueue.delete(k);
    }
  }

  /**
   * Try to update the value for the key.
   * @param k - Target key
   * @param v - Target value
   * @returns `true` if the update is successful
   */
  update(k: K, v: V) {
    for (const cache of this.cache) {
      if (this.kEqual(k, cache[0])) {
        cache[1] = v;
        return true;
      }
    }
    return false;
  }

  /**
   * Check if the key exists in `this.cache`.
   * @param k - Target key
   * @returns `true` if the key is exists
   */
  has(k: K) {
    for (const [_k] of this.cache) {
      if (this.kEqual(k, _k)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get the last value.
   * @returns Last value
   */
  last() {
    if (this.cache.length > 0) {
      return this.cache[0][1];
    }
  }
}

export class AsyncBufferRetriever<V> extends AsyncRetriever<Buffer, V> {
  protected kEqual(a: Buffer, b: Buffer) {
    return a.equals(b);
  }

  protected createReqQueue() {
    return createBufferFunctionalMap<RetrieveReq<V>[]>();
  }
}

export class AsyncBNRetrieve<V> extends AsyncRetriever<BN, V> {
  protected kEqual(a: BN, b: BN) {
    return a.eq(b);
  }

  protected createReqQueue() {
    return createBNFunctionalMap<RetrieveReq<V>[]>();
  }
}
