interface QueueLike<T> {
  push(data: T): void;
  hasNext: () => boolean;
  next: () => T;
}

export class AsyncNext<T = any> {
  private readonly queue: QueueLike<T>;
  private resolve?: (data: T) => void;

  constructor(queue: QueueLike<T>) {
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

export class AsyncNextArray<T = any> extends AsyncNext<T> {
  private readonly arr: T[] = [];

  constructor() {
    super({
      push: (data: T) => {
        this.arr.push(data);
      },
      hasNext: () => this.arr.length > 0,
      next: () => this.arr.shift()!
    });
  }
}
