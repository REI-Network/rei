import { Aborter } from '@gxchain2/utils';

export class Loop {
  protected readonly aborter = new Aborter();
  private abortPromise?: Promise<void>;
  private loopPromise?: Promise<void>;
  private readonly interval: number;

  constructor(interval: number) {
    this.interval = interval;
  }

  async startLoop() {
    if (this.abortPromise) {
      await this.abortPromise;
    }
    if (this.loopPromise) {
      return;
    }
    this.loopPromise = new Promise(async (resolve) => {
      while (!this.aborter.isAborted) {
        await this.aborter.abortablePromise(new Promise((r) => setTimeout(r, this.interval)));
        if (this.aborter.isAborted) {
          break;
        }
        await this.process();
      }
      resolve();
    });
  }

  async stopLoop() {
    if (this.loopPromise && !this.aborter.isAborted) {
      await (this.abortPromise = new Promise(async (resolve) => {
        await this.aborter.abort();
        await this.loopPromise;
        this.loopPromise = undefined;
        this.aborter.reset();
        resolve();
      }));
      this.abortPromise = undefined;
    }
  }

  protected async process() {
    throw new Error('Unimplemented');
  }
}
