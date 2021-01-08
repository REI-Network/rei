import { EventEmitter } from 'events';
import util from 'util';

import Heap from 'qheap';

import { AsyncQueue } from './asyncnext';

type Task<TData, TResult> = {
  data: TData;
  result?: TResult;
  index: number;
};

export class OrderedQueueAbortError extends Error {}

export declare interface OrderedQueue<TData = any, TResult = any> {
  on(event: 'result', listener: (data: TData, result?: TResult) => void): this;
  on(event: 'error', listener: (err: any, data: TData, index: number, result?: TResult) => void): this;

  once(event: 'result', listener: (data: TData, result?: TResult) => void): this;
  once(event: 'error', listener: (err: any, data: TData, index: number, result?: TResult) => void): this;
}

export class OrderedQueue<TData = any, TResult = any> extends EventEmitter {
  private readonly limit: number;
  private readonly processTask: (data: TData) => Promise<TResult> | TResult;
  private readonly limitQueue = new AsyncQueue<void>();
  private out!: Heap;
  private total: number = 0;
  private processed: number = 0;
  private abortFlag: boolean = false;
  private runningPromise?: Promise<void>;

  constructor(options: { limit: number; processTask: (data: TData) => Promise<TResult> | TResult }) {
    super();
    this.limit = options.limit;
    this.processTask = options.processTask;
    this.resetHeap();
  }

  private resetHeap() {
    if (this.out === undefined) {
      this.out = new Heap({ comparBefore: (a: Task<TData, TResult>, b: Task<TData, TResult>) => a.index < b.index });
    } else {
      while (this.out.length > 0) {
        const task = this.out.remove();
        this.emit('error', new OrderedQueueAbortError('OrderedQueue abort'), task.data, task.index, task.result);
      }
    }
  }

  private dequeue() {
    let task = this.out.peek();
    while (task && task.index === this.processed) {
      task = this.out.remove();
      this.processed++;
      this.emit('result', task.data, task.result);
      if (this.processed === this.total) {
        this.resolvePromise();
        return;
      }

      task = this.out.peek();
    }
  }

  private resolvePromise() {
    if (this.limitQueue.isWaiting) {
      this.limitQueue.push();
    }
  }

  async abort() {
    this.abortFlag = true;
    this.resolvePromise();
    if (this.runningPromise) {
      await this.runningPromise;
    }
    this.resetHeap();
  }

  async reset() {
    if (!this.abortFlag) {
      await this.abort();
    }
    this.abortFlag = false;
  }

  async start(total: number, generator: AsyncGenerator<Task<TData, TResult>>) {
    if (this.runningPromise || this.abortFlag) {
      throw new Error('OrderedQueue already started or aborted');
    }
    let runningResolve!: () => void;
    this.runningPromise = new Promise((resolve) => {
      runningResolve = resolve;
    });
    this.total = total;
    let promiseArray: Promise<void>[] = [];
    const processOver = (p: Promise<void>) => {
      const index = promiseArray.indexOf(p);
      if (index !== -1) {
        promiseArray.splice(index, 1);
        this.limitQueue.push();
      }
    };
    const makePromise = () => {
      return promiseArray.length < this.limit ? Promise.resolve() : this.limitQueue.next();
    };
    for await (const task of generator) {
      let result = this.processTask(task.data);
      result = (util.types.isPromise(result) ? result : Promise.resolve(result)) as Promise<TResult>;
      const p = result
        .then((result: TResult) => {
          task.result = result;
          this.out.insert(task);
          this.dequeue();
        })
        .catch((err) => {
          this.emit('error', err, task.data, task.index, task.result);
        })
        .finally(() => {
          processOver(p);
        });
      promiseArray.push(p);
      await makePromise();
    }
    if (promiseArray.length > 0) {
      await Promise.all(promiseArray);
    }
    this.total = 0;
    this.processed = 0;
    runningResolve();
    this.runningPromise = undefined;
  }
}
