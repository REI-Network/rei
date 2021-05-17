export class Loop {
  protected working: boolean = false;
  private shouldWork: boolean = false;
  private resolve?: () => void;
  private waitingPromise?: Promise<void>;
  private workingPromise?: Promise<void>;

  constructor(interval: number) {
    this.loop(interval);
  }

  /**
   * Start the loop according to the loopPromise
   */
  startLoop() {
    if (this.working !== false) {
      return;
    }
    this.working = true;
    if (this.resolve && this.waitingPromise) {
      this.resolve();
      this.resolve = undefined;
      this.waitingPromise = undefined;
    }

    // Start processing immediately.
    if (!this.workingPromise) {
      this.workingPromise = this.process();
    } else {
      this.shouldWork = true;
    }
  }

  /**
   * stop the loop according to the abortPromise
   */
  stopLoop() {
    if (this.working !== true) {
      return;
    }
    this.working = false;
  }

  private async loop(interval: number) {
    while (true) {
      if (this.shouldWork) {
        this.shouldWork = false;
      } else {
        if (interval === 0) {
          if (!this.working) {
            await (this.waitingPromise ||
              (this.waitingPromise = new Promise<void>((resolve) => {
                this.resolve = resolve;
              })));
          }
        } else {
          await Promise.race([
            new Promise((r) => setTimeout(r, interval)),
            this.waitingPromise ||
              (this.waitingPromise = new Promise<void>((resolve) => {
                this.resolve = resolve;
              }))
          ]);
        }
      }
      if (this.working && !this.workingPromise) {
        this.workingPromise = this.process();
      }
      if (this.workingPromise) {
        await this.workingPromise;
        this.workingPromise = undefined;
      }
    }
  }

  protected async process() {
    throw new Error('Unimplemented');
  }
}
