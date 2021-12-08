import { getRandomIntInclusive } from '@rei-network/utils';

type Getter<T> = {
  resolve(handler: T): void;
  reject(reason?: any): void;
  timeout: NodeJS.Timeout;
};

export class GetHandlerTimeoutError extends Error {}

/**
 * ProtocolPool is used to manage all the handlers
 */
export class HandlerPool<T> {
  private idlePool = new Set<T>();
  private busyPool = new Set<T>();
  private getterQueue: Getter<T>[] = [];

  private addIdleHandler(handler: T) {
    if (this.getterQueue.length > 0) {
      const getter = this.getterQueue.shift()!;
      clearTimeout(getter.timeout);
      getter.resolve(handler);
      this.busyPool.add(handler);
    } else {
      this.idlePool.add(handler);
    }
  }

  /**
   * Get all hanlders
   */
  get handlers() {
    return [...Array.from(this.idlePool), ...Array.from(this.busyPool)];
  }

  /**
   * Add a handler to pool
   * @param handler Handler object
   */
  add(handler: T) {
    this.addIdleHandler(handler);
  }

  /**
   * Remov handler from pool
   * @param handler Handler object
   * @returns `true` if successfully deleted
   */
  remove(handler: T): boolean {
    return this.idlePool.delete(handler) || this.busyPool.delete(handler);
  }

  /**
   * Randomly obtain a handler to process the request,
   * if there is no idle handler, just push the request into the queue
   * @param timeout Timeout period
   */
  get(timeout: number = 3 * 1000) {
    if (this.idlePool.size > 0) {
      const handler = Array.from(this.idlePool)[getRandomIntInclusive(0, this.idlePool.size - 1)];
      this.idlePool.delete(handler);
      this.busyPool.add(handler);
      return Promise.resolve(handler);
    }
    return new Promise<T>((resolve, reject) => {
      const getter = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.getterQueue.splice(this.getterQueue.indexOf(getter), 1);
          reject(new GetHandlerTimeoutError('ProtocolPool get handler timeout'));
        }, timeout)
      };
      this.getterQueue.push(getter);
    });
  }

  /**
   * Move the handler from the busy pool into the idle pool
   * @param handler Handler object
   */
  put(handler: T) {
    if (this.busyPool.delete(handler)) {
      this.addIdleHandler(handler);
    }
  }
}
