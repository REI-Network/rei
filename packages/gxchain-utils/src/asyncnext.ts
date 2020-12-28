interface AsyncNextOption<T> {
  push: (data: T) => void;
  hasNext: () => boolean;
  next: () => T;
}

export class AsyncNext<T = any> {
  private readonly queue: AsyncNextOption<T>;
  private resolve?: (data: T) => void;

  constructor(queue: AsyncNextOption<T>) {
    this.queue = queue;
  }

  get isWaiting() {
    return !!this.resolve;
  }

  push(data: T) {
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
      : new Promise<T>((resolve) => {
          this.resolve = resolve;
        });
  }
}

interface AsyncQueueOption<T> {
  push?: (data: T) => void;
  hasNext?: () => boolean;
  next?: () => T;
}

export class AsyncQueue<T = any> extends AsyncNext<T> {
  private arr: T[] = [];

  constructor(options?: AsyncQueueOption<T>) {
    super(
      Object.assign(
        {
          push: (data: T) => {
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
