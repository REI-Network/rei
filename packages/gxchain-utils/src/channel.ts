import Heap from 'qheap';

export class ChannelAbortError extends Error {}

export interface ChannelOption<T> {
  max?: number;
  drop?: (data: T) => void;
}

export class Channel<T = any> {
  private aborted = false;
  private _array: T[] = [];
  private max?: number;
  private drop?: (data: T) => void;
  private resolve?: (data: T) => void;
  private reject?: (reason?: any) => void;

  get array() {
    return [...this._array];
  }

  constructor(options?: ChannelOption<T>) {
    this.max = options?.max;
    this.drop = options?.drop;
  }

  push(data: T) {
    if (this.aborted) {
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
      this.reject(new ChannelAbortError());
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
      while (!this.aborted) {
        yield await this.next();
      }
    } catch (err) {
      if (!(err instanceof ChannelAbortError)) {
        throw err;
      }
    }
  }
}

export interface HChannelOption<T> extends ChannelOption<T> {
  compare?: (a: T, b: T) => boolean;
}

export class HChannel<T = any> {
  private aborted = false;
  private _heap: Heap;
  private max?: number;
  private drop?: (data: T) => void;
  private resolve?: (data: T) => void;
  private reject?: (reason?: any) => void;

  get heap() {
    return this._heap;
  }

  constructor(options?: HChannelOption<T>) {
    this.max = options?.max;
    this.drop = options?.drop;
    this._heap = new Heap(options?.compare ? { comparBefore: options.compare } : undefined);
  }

  push(data: T) {
    if (this.aborted) {
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
      this.reject(new ChannelAbortError());
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
      while (!this.aborted) {
        yield await this.next();
      }
    } catch (err) {
      if (!(err instanceof ChannelAbortError)) {
        throw err;
      }
    }
  }
}

export class PChannel<U = any, T extends { data: U; index: number } = { data: any; index: number }> {
  private processed: number = 0;
  private aborted = false;
  private _array: T[] = [];
  private _heap: Heap;
  private max?: number;
  private drop?: (data: T) => void;
  private resolve?: (data: T) => void;
  private reject?: (reason?: any) => void;

  get heap() {
    return this._heap;
  }

  get array() {
    return [...this._array];
  }

  constructor(options?: ChannelOption<T>) {
    this.max = options?.max;
    this.drop = options?.drop;
    this._heap = new Heap({
      comparBefore: (a: T, b: T) => a.index < b.index
    });
  }

  push(data: T) {
    if (this.aborted) {
      return false;
    }
    this._heap.insert(data);
    const q = this.readies();
    if (q.length > 0) {
      if (this.resolve) {
        this.resolve(q.shift()!);
        this.reject = undefined;
        this.resolve = undefined;
      }
      if (q.length > 0) {
        this._array = this._array.concat(q);
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
      this.reject(new ChannelAbortError());
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
    if (this.drop) {
      for (const data of this._array) {
        this.drop(data);
      }
    }
    this._array = [];
    this.processed = 0;
  }

  async *generator() {
    try {
      while (!this.aborted) {
        yield await this.next();
      }
    } catch (err) {
      if (!(err instanceof ChannelAbortError)) {
        throw err;
      }
    }
  }

  private readies() {
    let d: T | undefined;
    const q: T[] = [];
    while ((d = this._heap.peek()) && d !== undefined && d.index === this.processed) {
      this.processed++;
      q.push(d);
      this._heap.remove();
    }
    return q;
  }
}
