import Heap from 'qheap';

interface AsyncNextOption<T> {
  push: (data: T) => void;
  hasNext: () => boolean;
  next: () => T;
  drop?: (data: T) => void;
}

export class AsyncNext<T = any> {
  private readonly queue: AsyncNextOption<T>;
  private resolve?: (data: T) => void;
  private _shouldStop: boolean = false;
  protected drop?: (data: T) => void;

  constructor(option: AsyncNextOption<T>) {
    this.queue = {
      push: option.push,
      hasNext: option.hasNext,
      next: option.next
    };
    this.drop = option.drop;
  }

  get shouldStop() {
    return this._shouldStop;
  }

  get isWaiting() {
    return !!this.resolve;
  }

  abort() {
    if (!this.shouldStop) {
      this._shouldStop = true;
    }
  }

  push(data: T) {
    if (this.resolve) {
      this.resolve(data);
      this.resolve = undefined;
    } else {
      this.queue.push(data);
    }
  }

  next(): Promise<T | null> {
    if (this.shouldStop) {
      this._shouldStop = false;
      this.clear();
      return Promise.resolve(null);
    }
    return this.queue.hasNext()
      ? Promise.resolve(this.queue.next())
      : new Promise<T>((resolve) => {
          this.resolve = resolve;
        });
  }

  clear() {}
}

interface AsyncQueueOption<T> {
  push?: (data: T) => void;
  hasNext?: () => boolean;
  next?: () => T;
  max?: number;
  drop?: (data: T) => void;
}

export class AsyncQueue<T = any> extends AsyncNext<T> {
  private _array: T[] = [];
  private max?: number;

  constructor(options?: AsyncQueueOption<T>) {
    super(
      Object.assign(
        {
          push: (data: T) => {
            this._array.push(data);
            if (this.max && this._array.length > this.max) {
              if (this.drop) {
                this.drop(this._array.shift()!);
              } else {
                this._array.shift();
              }
            }
          },
          hasNext: () => this._array.length > 0,
          next: () => this._array.shift()!
        },
        options
      )
    );
    this.max = options?.max;
    this.drop = options?.drop;
  }

  get array() {
    return this._array;
  }

  clear() {
    if (this.drop) {
      for (const data of this._array) {
        this.drop(data);
      }
    }
    this._array = [];
  }
}

interface AsyncHeapOption<T> {
  compare?: (a: T, b: T) => boolean;
  push?: (data: T | null) => void;
  hasNext?: () => boolean;
  next?: () => T | null;
  drop?: (data: T) => void;
}

export class AsyncHeap<T = any> extends AsyncNext<T> {
  private _heap: Heap;
  private compare?: (a: T, b: T) => boolean;

  constructor(options?: AsyncHeapOption<T>) {
    super(
      Object.assign(
        {
          push: (data: T | null) => {
            this._heap.insert(data);
          },
          hasNext: () => this._heap.length > 0,
          next: () => this._heap.remove()
        },
        options
      )
    );
    this.compare = options?.compare;
    this._heap = new Heap(this.compare ? { comparBefore: this.compare } : undefined);
  }

  get heap() {
    return this._heap;
  }

  clear() {
    const array: T[] | null = this._heap._list;
    if (array !== null && this.drop) {
      for (const data of array) {
        this.drop(data);
      }
    }
    this._heap = new Heap(this.compare ? { comparBefore: this.compare } : undefined);
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

  push(data: T) {
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

  push(data: T) {
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
