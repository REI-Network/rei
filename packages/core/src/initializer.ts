import EventEmitter from 'events';

export abstract class Initializer {
  protected readonly initPromise: Promise<void>;
  protected initResolve?: () => void;

  constructor() {
    this.initPromise = new Promise<void>((resolve) => {
      this.initResolve = resolve;
    });
  }

  protected initOver() {
    if (this.initResolve === undefined) {
      throw new Error('missing initResolve');
    }
    this.initResolve();
    this.initResolve = undefined;
  }
}

export abstract class InitializerWithEventEmitter extends EventEmitter {
  protected readonly initPromise: Promise<void>;
  protected initResolve?: () => void;

  constructor() {
    super();
    this.initPromise = new Promise<void>((resolve) => {
      this.initResolve = resolve;
    });
  }

  protected initOver() {
    if (this.initResolve === undefined) {
      throw new Error('missing initResolve');
    }
    this.initResolve();
    this.initResolve = undefined;
  }
}
