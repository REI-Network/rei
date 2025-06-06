import Heap from 'qheap';

export class ChannelAbortError extends Error {}

export interface ChannelOption<T> {
  /**
   * Max channel size,
   * if the channel size is greater than this number,
   * it will drop the fisrt value
   */
  max?: number;
  /**
   * Drop callback,
   * it will be called when drop a value
   */
  drop?: (data: T) => void;
}

/**
 * An asynchronous queue, order by the order in which the elements are pushed
 */
export class Channel<T = any> {
  private aborted = false;
  private _array: T[] = [];
  private max?: number;
  private drop?: (data: T) => void;
  private resolve?: (data: T) => void;
  private reject?: (reason?: any) => void;

  /**
   * Get all data in the channel
   */
  get array() {
    return [...this._array];
  }

  constructor(options?: ChannelOption<T>) {
    this.max = options?.max;
    this.drop = options?.drop;
  }

  /**
   * Push data to channel
   * If the channel is waiting, resolve the promise
   * If the channel isn't waiting, push data to `_array` and cache it
   * @param data - Data
   * @returns `true` if successfully pushed, `false` if not
   */
  push(data: T) {
    if (this.aborted) {
      this.drop && this.drop(data);
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

  /**
   * Get next element in channel
   * If channel is empty, it will wait until new element pushed or the channel is aborted
   * @returns Next element
   */
  next() {
    return this._array.length > 0
      ? Promise.resolve(this._array.shift()!)
      : new Promise<T>((resolve, reject) => {
          this.resolve = resolve;
          this.reject = reject;
        });
  }

  /**
   * Abort channel
   */
  abort() {
    if (this.reject) {
      this.reject(new ChannelAbortError());
      this.reject = undefined;
      this.resolve = undefined;
    }
    this.aborted = true;
    this.clear();
  }

  /**
   * Reset channel
   */
  reset() {
    this.aborted = false;
  }

  /**
   * Clear channel and drop all data
   */
  clear() {
    if (this.drop) {
      for (const data of this._array) {
        this.drop(data);
      }
    }
    this._array = [];
  }

  /**
   * Return an async generator to fetch the data in channel
   */
  async *[Symbol.asyncIterator]() {
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
  /**
   * Customizable heap compare function,
   * default is less operator
   */
  compare?: (a: T, b: T) => boolean;
}

/**
 * An asynchronous queue, order by customizable heap
 */
export class HChannel<T = any> {
  private aborted = false;
  private _heap: Heap;
  private max?: number;
  private drop?: (data: T) => void;
  private resolve?: (data: T) => void;
  private reject?: (reason?: any) => void;

  /**
   * Get the data in the channel
   */
  get heap() {
    return this._heap;
  }

  constructor(options?: HChannelOption<T>) {
    this.max = options?.max;
    this.drop = options?.drop;
    this._heap = new Heap(
      options?.compare ? { comparBefore: options.compare } : undefined
    );
  }

  /**
   * Push data to channel
   * If the channel is waiting, resolve the promise
   * If the channel isn't waiting, push data to `_heap` and cache it
   * @param data - Data
   * @returns `true` if successfully pushed, `false` if not
   */
  push(data: T) {
    if (this.aborted) {
      this.drop && this.drop(data);
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

  /**
   * Get next element in channel
   * If channel is empty, it will wait until new element pushed or the channel is aborted
   * @returns Next element
   */
  next() {
    return this._heap.length > 0
      ? Promise.resolve(this._heap.remove() as T)
      : new Promise<T>((resolve, reject) => {
          this.resolve = resolve;
          this.reject = reject;
        });
  }

  /**
   * Abort channel
   */
  abort() {
    if (this.reject) {
      this.reject(new ChannelAbortError());
      this.reject = undefined;
      this.resolve = undefined;
    }
    this.aborted = true;
    this.clear();
  }

  /**
   * Reset channel
   */
  reset() {
    this.aborted = false;
  }

  /**
   * Clear channel and drop all data
   */
  clear() {
    while (this._heap.length > 0) {
      if (this.drop) {
        this.drop(this._heap.remove());
      } else {
        this._heap.remove();
      }
    }
  }

  /**
   * Return an async generator to fetch the data in channel
   */
  async *[Symbol.asyncIterator]() {
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

/**
 * An asynchronous queue, order by element index(grow from 0) and index must be continuous
 */
export class PChannel<
  U = any,
  T extends { data: U; index: number } = { data: U; index: number }
> {
  private processed = 0;
  private aborted = false;
  private _array: T[] = [];
  private _heap: Heap;
  private max?: number;
  private drop?: (data: T) => void;
  private resolve?: (data: T) => void;
  private reject?: (reason?: any) => void;

  /**
   * Get the data in the channel
   */
  get heap() {
    return this._heap;
  }

  /**
   * Get the data in the channel
   */
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

  /**
   * Push data to channel,
   * firstly, push the data to `_heap`,
   * if the index is continuous, push all ready data to `_array`
   * @param data - Data
   * @returns `true` if successfully pushed, `false` if not
   */
  push(data: T) {
    if (this.aborted) {
      this.drop && this.drop(data);
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

  /**
   * Get next element in channel
   * If channel is empty, it will wait until new element pushed or the channel is aborted
   * @returns Next element
   */
  next() {
    return this._array.length > 0
      ? Promise.resolve(this._array.shift()!)
      : new Promise<T>((resolve, reject) => {
          this.resolve = resolve;
          this.reject = reject;
        });
  }

  /**
   * Abort channel
   */
  abort() {
    if (this.reject) {
      this.reject(new ChannelAbortError());
      this.reject = undefined;
      this.resolve = undefined;
    }
    this.aborted = true;
    this.clear();
  }

  /**
   * Reset channel
   */
  reset() {
    this.aborted = false;
  }

  /**
   * Clear channel and drop all data
   */
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

  /**
   * Return an async generator to fetch the data in channel
   */
  async *[Symbol.asyncIterator]() {
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

  /**
   * Get all ready elements in the heap
   * @returns The elements array
   */
  private readies() {
    let d: T | undefined;
    const q: T[] = [];
    while (
      (d = this._heap.peek()) &&
      d !== undefined &&
      d.index === this.processed
    ) {
      this.processed++;
      q.push(d);
      this._heap.remove();
    }
    return q;
  }
}
