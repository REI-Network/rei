export class Loop {
  protected working: boolean = false;
  private resolve?: () => void;

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
    if (this.resolve) {
      this.resolve();
      this.resolve = undefined;
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
      await Promise.race([
        new Promise((r) => setTimeout(r, interval)),
        new Promise<void>((resolve) => {
          this.resolve = resolve;
        })
      ]);
      if (this.working) {
        await this.process();
      }
    }
  }

  protected async process() {
    throw new Error('Unimplemented');
  }
}
