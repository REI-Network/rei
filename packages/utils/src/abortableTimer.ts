export class AbortableTimer {
  private r?: () => void;
  private timeout?: NodeJS.Timeout;

  wait(timeout: number) {
    if (this.r || this.timeout) {
      throw new Error('timer has started');
    }

    return new Promise<void>((r) => {
      this.r = r;
      this.timeout = setTimeout(() => {
        r();
        this.r = undefined;
        this.timeout = undefined;
      }, timeout);
    });
  }

  abort() {
    if (this.r) {
      this.r();
      this.r = undefined;
    }
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
  }
}
