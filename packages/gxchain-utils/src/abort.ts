export class AbortError extends Error {}

export class Aborter {
  private _reason: any;
  private _abort: boolean = true;
  private _waiting = new Set<{
    p: Promise<void>;
    r: () => void;
    j: (reason?: any) => void;
  }>();

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
    const w = this.createWaitingPromise();
    try {
      const result = (await Promise.race([w.p, p])) as T;
      w.r();
      this._waiting.delete(w);
      return result;
    } catch (err) {
      w.r();
      this._waiting.delete(w);
      if (!(err instanceof AbortError)) {
        throw err;
      } else if (throwAbortError) {
        throw err;
      }
    }
  }

  private createWaitingPromise() {
    let r!: () => void;
    let j!: (reason?: any) => void;
    const p = new Promise<void>((resolve, reject) => {
      r = resolve;
      j = reject;
    });
    const w = { p, r, j };
    this._waiting.add(w);
    return w;
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
      if (this._waiting.size > 0) {
        this._waiting.forEach(({ j }) => j(reason));
        await Promise.all(Array.from(this._waiting).map(({ p }) => p.catch(() => {})));
      }
    }
  }

  reset() {
    if (this._abort) {
      this._reason = undefined;
      this._abort = false;
    }
  }
}
