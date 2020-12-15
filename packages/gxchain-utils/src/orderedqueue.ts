import { EventEmitter } from 'events';

import Heap from 'qheap';

type Task = {
  data: any;
  result?: any;
  index: number;
};

export declare interface OrderedQueue {
  on(event: 'result', listener: (queue: OrderedQueue, data: any, result?: any) => void): this;
  on(event: 'error', listener: (queue: OrderedQueue, err: any) => void): this;

  once(event: 'result', listener: (queue: OrderedQueue, data: any, result?: any) => void): this;
  once(event: 'error', listener: (queue: OrderedQueue, err: any) => void): this;
}

export class OrderedQueue extends EventEmitter {
  private readonly in = new Heap({ comparBefore: (a: Task, b: Task) => a.index < b.index });
  private readonly out = new Heap({ comparBefore: (a: Task, b: Task) => a.index < b.index });
  private readonly limit: number;
  private readonly processTask: (data: any) => Promise<any>;
  private total: number = 0;
  private processed: number = 0;
  private running: boolean = false;
  private abortFlag: boolean = false;
  private taskResolve?: (task?: Task) => void;
  private limitResolve?: () => void;

  constructor(options: { limit: number; taskData?: any[]; processTask: (data: any) => Promise<any> }) {
    super();
    this.limit = options.limit;
    this.processTask = options.processTask;
    if (options.taskData) {
      options.taskData.forEach((data) => this.insert(data));
    }
  }

  private enqueue(task: Task) {
    if (this.taskResolve) {
      this.taskResolve(task);
      this.taskResolve = undefined;
    } else {
      this.in.insert(task);
    }
  }

  private dequeue() {
    let task = this.out.peek();
    while (task && task.index === this.processed) {
      task = this.out.remove();
      this.emit('result', this, task.data, task.result);
      if (this.processed === this.total) {
        this.resolvePromise();
        return;
      }

      this.processed++;
      task = this.out.peek();
    }
  }

  private async *makeAsyncGenerator(): AsyncGenerator<Task> {
    while (!this.abortFlag) {
      let task = this.in.remove();
      if (!task) {
        if (this.processed === this.total) {
          return;
        }
        task = await new Promise<Task | undefined>((resolve) => {
          this.taskResolve = resolve;
        });
        if (!task) {
          return;
        }
      }
      yield task;
    }
  }

  private resolvePromise() {
    if (this.taskResolve) {
      this.taskResolve(undefined);
      this.taskResolve = undefined;
    }
    if (this.limitResolve) {
      this.limitResolve();
      this.limitResolve = undefined;
    }
  }

  abort() {
    this.abortFlag = true;
    this.resolvePromise();
  }

  insert(data: any) {
    this.enqueue({
      data,
      index: this.total++
    });
  }

  async start() {
    if (this.running) {
      throw new Error('OrderedQueue already started');
    }
    this.running = true;
    let promiseArray: Promise<void>[] = [];
    const processOver = (p: Promise<void>) => {
      const index = promiseArray.indexOf(p);
      if (index !== -1) {
        promiseArray.splice(index, 1);
        if (this.limitResolve) {
          this.limitResolve();
          this.limitResolve = undefined;
        }
      }
    };
    const makePromise = () => {
      return promiseArray.length < this.limit
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            this.limitResolve = resolve;
          });
    };
    for await (const task of this.makeAsyncGenerator()) {
      const p = this.processTask(task.data)
        .then((result: any) => {
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
    this.running = false;
  }
}
