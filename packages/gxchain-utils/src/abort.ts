export class Aborter {
  private _reason: any;
  private _using: number = 0;
  private _abort: boolean = true;
  private _abortPromise!: Promise<void>;
  private _resolve!: () => void;
  private _reject!: (reason?: any) => void;

  get reason() {
    return this.reason;
  }

  get isAborted() {
    return this._abort;
  }

  constructor() {
    this.reset();
  }

  async abortablePromise<T>(p: Promise<T>): Promise<T> {
    if (this._abort) {
      return Promise.reject(this._reason);
    }
    try {
      this._using++;
      const res = (await Promise.race([this._abortPromise, p])) as T;
      this._using--;
      return res;
    } catch (err) {
      if (!this.isAborted) {
        this._using--;
      }
      throw err;
    }
  }

  abort(reason?: any) {
    if (!this._abort) {
      this._reason = reason;
      this._abort = true;
      if (this._using > 0) {
        this._using = 0;
        this._reject(reason);
      } else {
        this._resolve();
      }
    }
  }

  reset() {
    if (this._abort) {
      this._reason = undefined;
      this._abort = false;
      this._abortPromise = new Promise((resolve, reject) => {
        this._resolve = resolve;
        this._reject = reject;
      });
    }
  }

  resolve() {
    if (!this._abort) {
      if (this._using > 0) {
        throw new Error('Aborter is in using, can not resolve!');
      }
      this._abort = true;
      this._resolve();
    }
  }
}
