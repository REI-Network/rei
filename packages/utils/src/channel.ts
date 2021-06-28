import Heap from 'qheap';

export class ChannelAbortError extends Error {}

export interface ChannelOption<T> {
  max?: number;
  drop?: (data: T) => void;
}

/**
 * Channel class, the storage structure is an array
 */
export class Channel<T = any> {
  private aborted = false;
  private _array: T[] = [];
  private max?: number;
  private drop?: (data: T) => void;
  private resolve?: (data: T) => void;
  private reject?: (reason?: any) => void;

  /**
   * Get the data in the array
   */
  get array() {
    return [...this._array];
  }

  constructor(options?: ChannelOption<T>) {
    this.max = options?.max;
    this.drop = options?.drop;
  }

  /**
   * Push data into array
   * @param data Data to be processed
   * @returns `true` if successfully pushed
   */
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

  /**
   * Next is an iterative function
   * @returns The first element in the array if the array.length is
   * greater than zero, else new a Promise
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
   * Issue an interrupt command to clean up the channel
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
   * Reset aborted status
   */
  reset() {
    this.aborted = false;
  }

  /**
   * Clear the channel and drop the data in array
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
   * Iterator function, used to get data in the channel
   */
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

/**
 * Channel class, the storage structure is a heap
 */
export class HChannel<T = any> {
  private aborted = false;
  private _heap: Heap;
  private max?: number;
  private drop?: (data: T) => void;
  private resolve?: (data: T) => void;
  private reject?: (reason?: any) => void;

  /**
   * Get the data in the heap
   */
  get heap() {
    return this._heap;
  }

  constructor(options?: HChannelOption<T>) {
    this.max = options?.max;
    this.drop = options?.drop;
    this._heap = new Heap(options?.compare ? { comparBefore: options.compare } : undefined);
  }

  /**
   * Insert data into heap
   * @param data Data to be processed
   * @returns `true` if successfully pushed
   */
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

  /**
   * Next is an iterative function
   * @returns The first element in the heap if the heap.length is
   * greater than zero, else new a Promise
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
   * Issue an interrupt command to clean up the channel
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
   * Reset aborted status
   */
  reset() {
    this.aborted = false;
  }

  /**
   * Clear the channel and drop the data in heap
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
   * Iterator function, used to get data in the channel
   */
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

/**
 * Channel class, the storage structures are array and heap
 */
export class PChannel<U = any, T extends { data: U; index: number } = { data: any; index: number }> {
  private processed: number = 0;
  private aborted = false;
  private _array: T[] = [];
  private _heap: Heap;
  private max?: number;
  private drop?: (data: T) => void;
  private resolve?: (data: T) => void;
  private reject?: (reason?: any) => void;

  /**
   * Get the data in the heap
   */
  get heap() {
    return this._heap;
  }

  /**
   * Get the data in the array
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
   * Push the element into the heap and add it to the array after sorting
   * @param data Data to be processed
   * @returns `true` if successfully pushed
   */
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

  /**
   * Clear the channel and drop the data in heap and array
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

  /**
   * Get the processed elements in the heap
   * @returns The elements array
   */
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
