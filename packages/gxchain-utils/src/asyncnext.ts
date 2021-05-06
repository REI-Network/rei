import Heap from 'qheap';
import { Aborter, AbortError } from './abort';

interface ChannelOption<T> {
  max?: number;
  drop?: (data: T) => void;
  aborter: Aborter;
}

export class Channel<T = any> {
  private aborted = false;
  private _array: T[] = [];
  private max?: number;
  private drop?: (data: T) => void;
  private resolve?: (data: T) => void;
  private reject?: (reason?: any) => void;
  private aborter: Aborter;

  get array() {
    return [...this._array];
  }

  constructor(options: ChannelOption<T>) {
    this.max = options.max;
    this.drop = options.drop;
    this.aborter = options.aborter;
  }

  push(data: T) {
    if (this.aborter.isAborted || this.aborted) {
      return false;
    }
    if (this.resolve) {
      this.resolve(data);
      this.reject = undefined;
      this.resolve = undefined;
    } else {
      this._array.push(data);
      if (this.max && this._array.length > this.max) {
        if (this.drop) {
          while (this._array.length > this.max) {
            this.drop(this._array.shift()!);
          }
        } else {
          this._array.splice(0, this._array.length - this.max);
        }
      }
    }
    return true;
  }

  next() {
    return this._array.length > 0
      ? Promise.resolve(this._array.shift()!)
      : new Promise<T>((resolve, reject) => {
          this.resolve = resolve;
          this.reject = reject;
        });
  }

  abort() {
    if (this.reject) {
      this.reject(new AbortError('Channel abort'));
      this.reject = undefined;
      this.resolve = undefined;
    }
    this.aborted = true;
    this.clear();
  }

  reset() {
    this.aborted = false;
  }

  clear() {
    if (this.drop) {
      for (const data of this._array) {
        this.drop(data);
      }
    }
    this._array = [];
  }

  async *generator() {
    try {
      while (!this.aborter.isAborted && !this.aborted) {
        yield await this.aborter.abortablePromise(this.next(), true);
      }
    } catch (err) {
      if (!(err instanceof AbortError)) {
        throw err;
      }
    }
  }
}

interface HChannelOption<T> {
  max?: number;
  aborter: Aborter;
  compare?: (a: T, b: T) => boolean;
  drop?: (data: T) => void;
}

export class HChannel<T = any> {
  private aborted = false;
  private _heap: Heap;
  private max?: number;
  private drop?: (data: T) => void;
  private resolve?: (data: T) => void;
  private reject?: (reason?: any) => void;
  private aborter: Aborter;

  get heap() {
    return this._heap;
  }

  constructor(options: HChannelOption<T>) {
    this.max = options.max;
    this.drop = options.drop;
    this.aborter = options.aborter;
    this._heap = new Heap(options?.compare ? { comparBefore: options.compare } : undefined);
  }

  push(data: T) {
    if (this.aborter.isAborted || this.aborted) {
      return false;
    }
    if (this.resolve) {
      this.resolve(data);
      this.reject = undefined;
      this.resolve = undefined;
    } else {
      this._heap.insert(data);
      if (this.max && this._heap.length > this.max) {
        while (this._heap.length > this.max) {
          if (this.drop) {
            this.drop(this._heap.remove());
          } else {
            this._heap.remove();
          }
        }
      }
    }
    return true;
  }

  next() {
    return this._heap.length > 0
      ? Promise.resolve(this._heap.remove() as T)
      : new Promise<T>((resolve, reject) => {
          this.resolve = resolve;
          this.reject = reject;
        });
  }

  abort() {
    if (this.reject) {
      this.reject(new AbortError('HChannel abort'));
      this.reject = undefined;
      this.resolve = undefined;
    }
    this.aborted = true;
    this.clear();
  }

  reset() {
    this.aborted = false;
  }

  clear() {
    while (this._heap.length > 0) {
      if (this.drop) {
        this.drop(this._heap.remove());
      } else {
        this._heap.remove();
      }
    }
  }

  async *generator() {
    try {
      while (!this.aborter.isAborted && !this.aborted) {
        yield await this.aborter.abortablePromise(this.next(), true);
      }
    } catch (err) {
      if (!(err instanceof AbortError)) {
        throw err;
      }
    }
  }
}
