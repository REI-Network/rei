import { EventEmitter } from 'events';
import Heap from 'qheap';

type Data<T> = {
  data: T;
  index: number;
};

export declare interface PriorityQueue<T = any> {
  on(event: 'reset' | 'result', listener: (data: T, index: number) => void): this;

  once(event: 'reset' | 'result', listener: (data: T, index: number) => void): this;
}

export class PriorityQueue<T = any> extends EventEmitter {
  private heap: Heap;

  private total: number = 0;
  private processed: number = 0;

  constructor() {
    super();
    this.reset();
  }

  reset() {
    if (this.heap === undefined) {
      this.heap = new Heap({ comparBefore: (a: Data<T>, b: Data<T>) => a.index < b.index });
    } else {
      let data: Data<T> | undefined;
      while ((data = this.heap.remove())) {
        this.emit('reset', data.data, data.index);
      }
    }
    this.total = 0;
    this.processed = 0;
  }

  insert(data: T, index?: number) {
    this.heap.insert({
      data,
      index: index === undefined ? this.total++ : index
    });
    this.process();
  }

  private process() {
    let data: Data<T> | undefined;
    while ((data = this.heap.peek()) && data !== undefined && data.index === this.processed) {
      this.processed++;
      this.emit('result', data.data, data.index);
      this.heap.remove();
    }
  }
}
