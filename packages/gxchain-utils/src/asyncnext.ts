import Heap from 'qheap';

interface AsyncNextOption<T> {
  push: (data: T | null) => void;
  hasNext: () => boolean;
  next: () => T | null;
}

export class AsyncNext<T = any> {
  private readonly queue: AsyncNextOption<T>;
  private resolve?: (data: T | null) => void;

  constructor(queue: AsyncNextOption<T>) {
    this.queue = queue;
  }

  get isWaiting() {
    return !!this.resolve;
  }

  push(data: T | null) {
    if (this.resolve) {
      this.resolve(data);
      this.resolve = undefined;
    } else {
      this.queue.push(data);
    }
  }

  next() {
    return this.queue.hasNext()
      ? Promise.resolve(this.queue.next())
      : new Promise<T | null>((resolve) => {
          this.resolve = resolve;
        });
  }
}

interface AsyncQueueOption<T> {
  push?: (data: T | null) => void;
  hasNext?: () => boolean;
  next?: () => T | null;
  max?: number;
  drop?: (data: T) => void;
}

export class AsyncQueue<T = any> extends AsyncNext<T> {
  private arr: (T | null)[] = [];
  private max?: number;
  private drop?: (data: T) => void;

  constructor(options?: AsyncQueueOption<T>) {
    super(
      Object.assign(
        {
          push: (data: T | null) => {
            this.arr.push(data);
            if (this.max && this.arr.length > this.max) {
              if (this.drop) {
                this.drop(this.arr.shift()!);
              } else {
                this.arr.shift();
              }
            }
          },
          hasNext: () => this.arr.length > 0,
          next: () => this.arr.shift()!
        },
        options
      )
    );
    this.max = options?.max;
    this.drop = options?.drop;
  }

  get array() {
    return this.arr;
  }

  clear() {
    this.arr = [];
  }

  abort() {
    if (this.isWaiting) {
      this.push(null);
    }
  }
}

interface AsyncHeapOption<T> {
  compare?: (a: T, b: T) => boolean;
  push?: (data: T | null) => void;
  hasNext?: () => boolean;
  next?: () => T | null;
}

export class AsyncHeap<T = any> extends AsyncNext<T> {
  private h: Heap;
  private compare?: (a: T, b: T) => boolean;

  constructor(options?: AsyncHeapOption<T>) {
    super(
      Object.assign(
        {
          push: (data: T | null) => {
            if (data !== null) {
              this.h.insert(data);
            }
          },
          hasNext: () => this.h.length > 0,
          next: () => this.h.remove()
        },
        options
      )
    );
    this.compare = options?.compare;
    this.h = new Heap(this.compare ? { comparBefore: this.compare } : undefined);
  }

  get heap() {
    return this.h;
  }

  clear() {
    this.h = new Heap(this.compare ? { comparBefore: this.compare } : undefined);
  }

  abort() {
    if (this.isWaiting) {
      this.push(null);
    }
  }
}

interface AysncChannelOption<T> extends AsyncQueueOption<T> {
  isAbort: () => boolean;
}

export class AysncChannel<T = any> extends AsyncQueue<T> {
  private isAbort: () => boolean;

  constructor(options: AysncChannelOption<T>) {
    super(options);
    this.isAbort = options.isAbort;
  }

  push(data: T | null) {
    if (!this.isAbort()) {
      super.push(data);
    }
  }

  async *generator() {
    while (!this.isAbort()) {
      const result = await this.next();
      if (this.isAbort() || result === null) {
        return;
      }
      yield result;
    }
  }
}

interface AysncHeapChannelOption<T> extends AsyncHeapOption<T> {
  isAbort: () => boolean;
}

export class AysncHeapChannel<T = any> extends AsyncHeap<T> {
  private isAbort: () => boolean;

  constructor(options: AysncHeapChannelOption<T>) {
    super(options);
    this.isAbort = options.isAbort;
  }

  async *generator() {
    while (!this.isAbort()) {
      const result = await this.next();
      if (this.isAbort() || result === null) {
        return;
      }
      yield result;
    }
  }
}
