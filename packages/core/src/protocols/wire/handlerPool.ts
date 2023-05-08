import { getRandomIntInclusive } from '@rei-network/utils';

interface IHandler {
  get id(): string;
}

type Getter<T extends IHandler> = {
  resolve(handler: T): void;
  reject(reason?: any): void;
  timeout: NodeJS.Timeout;
};

export class GetHandlerTimeoutError extends Error {}

/**
 * ProtocolPool is used to manage all the handlers
 */
export class HandlerPool<T extends IHandler> {
  readonly idlePool = new Map<string, T>();
  readonly busyPool = new Map<string, T>();
  private getterQueue: Getter<T>[] = [];

  private addIdleHandler(handler: T) {
    if (this.getterQueue.length > 0) {
      const getter = this.getterQueue.shift()!;
      clearTimeout(getter.timeout);
      getter.resolve(handler);
      this.busyPool.set(handler.id, handler);
    } else {
      this.idlePool.set(handler.id, handler);
    }
  }

  /**
   * Get all hanlders
   */
  get handlers() {
    return [...Array.from(this.idlePool.values()), ...Array.from(this.busyPool.values())];
  }

  /**
   * Check if id already exists
   * @param id
   */
  has(id: string) {
    return this.busyPool.has(id) || this.idlePool.has(id);
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
    return this.idlePool.delete(handler.id) || this.busyPool.delete(handler.id);
  }

  /**
   * Randomly obtain a handler to process the request,
   * if there is no idle handler, just push the request into the queue
   * @param timeout Timeout period
   */
  get(timeout: number = 3 * 1000) {
    if (this.idlePool.size > 0) {
      const handler = Array.from(this.idlePool.values())[getRandomIntInclusive(0, this.idlePool.size - 1)];
      this.idlePool.delete(handler.id);
      this.busyPool.set(handler.id, handler);
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
    if (this.busyPool.delete(handler.id)) {
      this.addIdleHandler(handler);
    }
  }
}
