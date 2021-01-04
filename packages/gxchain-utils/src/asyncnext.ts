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
}

export class AsyncQueue<T = any> extends AsyncNext<T> {
  private arr: (T | null)[] = [];

  constructor(options?: AsyncQueueOption<T>) {
    super(
      Object.assign(
        {
          push: (data: T | null) => {
            this.arr.push(data);
          },
          hasNext: () => this.arr.length > 0,
          next: () => this.arr.shift()!
        },
        options
      )
    );
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

interface AysncChannelOption<T> extends AsyncQueueOption<T> {
  isAbort: () => boolean;
}

export class AysncChannel<T = any> extends AsyncQueue<T> {
  private isAbort: () => boolean;

  constructor(options: AysncChannelOption<T>) {
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
