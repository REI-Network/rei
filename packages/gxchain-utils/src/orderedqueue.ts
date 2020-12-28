import { EventEmitter } from 'events';
import util from 'util';

import Heap from 'qheap';

import { AsyncNext, AsyncQueue } from './asyncnext';

type Task<TData, TResult> = {
  data: TData;
  result?: TResult;
  index: number;
};

export declare interface OrderedQueue {
  on(event: 'over', listener: (queue: OrderedQueue) => void): this;
  on(event: 'result', listener: (queue: OrderedQueue, data: any, result?: any) => void): this;
  on(event: 'error', listener: (queue: OrderedQueue, err: any) => void): this;

  once(event: 'over', listener: (queue: OrderedQueue) => void): this;
  once(event: 'result', listener: (queue: OrderedQueue, data: any, result?: any) => void): this;
  once(event: 'error', listener: (queue: OrderedQueue, err: any) => void): this;
}

export class OrderedQueue<TData = any, TResult = any> extends EventEmitter {
  private readonly limit: number;
  private readonly processTask: (data: TData) => Promise<TResult> | TResult;
  private readonly taskQueue: AsyncNext<Task<TData, TResult>>;
  private readonly limitQueue = new AsyncQueue<void>();
  private in!: Heap;
  private out!: Heap;
  private total: number = 0;
  private currentTotal: number = 0;
  private processed: number = 0;
  private abortFlag: boolean = false;
  private runningPromise?: Promise<void>;

  constructor(options: { limit: number; taskData?: TData[]; processTask: (data: TData) => Promise<TResult> | TResult }) {
    super();
    this.limit = options.limit;
    this.processTask = options.processTask;
    this.resetHeap();
    this.taskQueue = new AsyncNext<Task<TData, TResult>>({
      push: (task: Task<TData, TResult> | null) => {
        if (task !== null) {
          this.in.insert(task);
        }
      },
      hasNext: () => this.in.length > 0,
      next: () => this.in.remove()
    });
    if (options.taskData) {
      options.taskData.forEach((data) => this.insert(data));
    }
  }

  private resetHeap() {
    if (this.in === undefined || this.in.length > 0) {
      this.in = new Heap({ comparBefore: (a: Task<TData, TResult>, b: Task<TData, TResult>) => a.index < b.index });
    }
    if (this.out === undefined || this.out.lenght > 0) {
      this.out = new Heap({ comparBefore: (a: Task<TData, TResult>, b: Task<TData, TResult>) => a.index < b.index });
    }
  }

  private enqueue(task: Task<TData, TResult>) {
    this.taskQueue.push(task);
  }

  private dequeue() {
    let task = this.out.peek();
    while (task && task.index === this.processed) {
      task = this.out.remove();
      this.processed++;
      this.emit('result', this, task.data, task.result);
      if (this.processed === this.total) {
        this.resolvePromise();
        return;
      }

      task = this.out.peek();
    }
  }

  private async *generator(): AsyncGenerator<Task<TData, TResult>> {
    while (!this.abortFlag) {
      const task = await this.taskQueue.next();
      if (this.abortFlag || task === null) {
        return;
      }
      yield task;
    }
  }

  private resolvePromise() {
    if (this.taskQueue.isWaiting) {
      this.taskQueue.push(null);
    }
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

  insert(data: TData) {
    if (this.abortFlag) {
      throw new Error('OrderedQueue already aborted');
    }
    this.enqueue({
      data,
      index: this.currentTotal++
    });
  }

  async start(total: number) {
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
    for await (const task of this.generator()) {
      let result = this.processTask(task.data);
      result = (util.types.isPromise(result) ? result : Promise.resolve(result)) as Promise<TResult>;
      const p = result
        .then((result: TResult) => {
          task.result = result;
          this.out.insert(task);
          this.dequeue();
        })
        .catch((err) => {
          this.emit('error', this, err);
          this.enqueue(task);
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
    this.currentTotal = 0;
    this.processed = 0;
    runningResolve();
    this.runningPromise = undefined;
    this.emit('over', this);
  }
}
