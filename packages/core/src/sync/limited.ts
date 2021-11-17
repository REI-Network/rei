export class LimitedConcurrency {
  readonly limit: number;
  private _concurrency: number = 0;
  private concurrencyPromise?: Promise<void>;
  private concurrencyResolve?: () => void;
  private finishedPromise?: Promise<void>;
  private finishedResolve?: () => void;

  constructor(limit: number) {
    if (limit <= 0) {
      throw new Error('invalid limit');
    }
    this.limit = limit;
  }

  get concurrency() {
    return this._concurrency;
  }

  get isLimited() {
    return this._concurrency > this.limit;
  }

  finished() {
    return this.finishedPromise ?? Promise.resolve();
  }

  async newConcurrency<T>(fn: () => Promise<T>) {
    while (true) {
      if (this._concurrency < this.limit) {
        break;
      } else if (this.concurrencyPromise) {
        await this.concurrencyPromise;
      } else {
        throw new Error('missing concurrency promise');
      }
    }

    if (this._concurrency === 0 && this.finishedPromise === undefined) {
      this.finishedPromise = new Promise<void>((resolve) => {
        this.finishedResolve = resolve;
      });
    }

    if (this._concurrency === this.limit - 1 && this.concurrencyPromise === undefined) {
      this.concurrencyPromise = new Promise<void>((resolve) => {
        this.concurrencyResolve = resolve;
      });
    }
    this._concurrency++;

    const release = () => {
      const newConcurrency = --this._concurrency;
      if (newConcurrency === 0 && this.finishedResolve) {
        this.finishedResolve();
        this.finishedPromise = undefined;
        this.finishedResolve = undefined;
      }

      if (newConcurrency === this.limit - 1 && this.concurrencyResolve) {
        this.concurrencyResolve();
        this.concurrencyPromise = undefined;
        this.concurrencyResolve = undefined;
      }
    };

    return {
      promise: fn()
        .then((result) => {
          release();
          return result;
        })
        .catch((err) => {
          release();
          throw err;
        })
    };
  }
}
