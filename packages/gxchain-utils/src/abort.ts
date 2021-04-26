export class AbortError extends Error {}

export class Aborter {
  private _reason: any;
  private _abort: boolean = true;
  private _abortPromise!: Promise<void>;
  private _resolve!: () => void;
  private _reject!: (reason?: any) => void;
  private _waitingPromises: Promise<void>[] = [];

  get reason() {
    return this._reason;
  }

  get isAborted() {
    return this._abort;
  }

  constructor() {
    this.reset();
  }

  async abortablePromise<T>(p: Promise<T>): Promise<T | undefined>;
  async abortablePromise<T>(p: Promise<T>, throwAbortError: false): Promise<T | undefined>;
  async abortablePromise<T>(p: Promise<T>, throwAbortError: true): Promise<T>;
  async abortablePromise<T>(p: Promise<T>, throwAbortError: boolean): Promise<T | undefined>;
  async abortablePromise<T>(p: Promise<T>, throwAbortError: boolean = false): Promise<T | undefined> {
    if (this._abort) {
      if (throwAbortError) {
        return Promise.reject(this._reason);
      } else {
        return Promise.resolve(undefined);
      }
    }
    try {
      const result = (await Promise.race([this._abortPromise, p])) as T;
      return result;
    } catch (err) {
      if (!(err instanceof AbortError)) {
        throw err;
      } else if (throwAbortError) {
        throw err;
      }
    }
  }

  addWaitingPromise<T>(p: Promise<T>) {
    const promise = p.then(
      () => {
        this._waitingPromises.splice(this._waitingPromises.indexOf(promise), 1);
      },
      () => {
        this._waitingPromises.splice(this._waitingPromises.indexOf(promise), 1);
      }
    );
    this._waitingPromises.push(promise);
  }

  async abort(reason?: string | AbortError) {
    if (!this._abort) {
      if (reason === undefined) {
        reason = new AbortError();
      } else if (typeof reason === 'string') {
        reason = new AbortError(reason);
      }
      this._reason = reason;
      this._abort = true;
      if (this._waitingPromises.length > 0) {
        this._reject(reason);
        await Promise.all(this._waitingPromises);
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
    } else {
      throw new Error('Aboter should abort before reset');
    }
  }

  resolve() {
    if (!this._abort) {
      if (this._waitingPromises.length > 0) {
        throw new Error('Aborter is in using, can not resolve!');
      }
      this._abort = true;
      this._resolve();
    }
  }
}
