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

  protected abstract kEqual(a: K, b: K): boolean;
  protected abstract createReqQueue(): Map<K, RetrieveReq<V>[]>;

  constructor(maxCacheSize: number, duration: number) {
    if (maxCacheSize < 1 || duration < 1) {
      throw new Error('AsyncGetter, invalid size or duration');
    }
    this.timeoutQueue = new TimeoutQueue(duration);
    this.maxCacheSize = maxCacheSize;
    this.reqQueue = this.createReqQueue();
  }

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

  update(k: K, v: V) {
    for (const cache of this.cache) {
      if (this.kEqual(k, cache[0])) {
        cache[1] = v;
        return true;
      }
    }
    return false;
  }

  has(k: K) {
    for (const [_k] of this.cache) {
      if (this.kEqual(k, _k)) {
        return true;
      }
    }
    return false;
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
