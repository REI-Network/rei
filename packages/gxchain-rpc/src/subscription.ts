import { uuidv4 } from 'uuid';
import { Aborter } from '@gxchain2/utils';
function randomIDGenetator(): string {
  return uuidv4();
}

class Subscription {
  ID: string;
  namespace: string;
  activated: boolean;
  constructor(namespace: string) {
    this.ID = randomIDGenetator();
    this.namespace = namespace;
    this.activated = true;
  }

  notify(id: string, data: any) {
    if (this.ID != id) {
      ws.send('Notify with wrong ID');
      return;
    }
    if (this.activated) {
      ws.send(JSON.stringify(data));
    }
  }
}

const deadline = 5 * 60 * 1000;
type fulter = {
  typ: string;
  deadline: number;
  hashes: Buffer[];
  logs: Buffer[];
  s: Subscription;
};

class Filters {
  private aborter = new Aborter();
  private readonly initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.init();
  }
  async abort() {
    await this.aborter.abort();
  }

  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
  }

  private async timeoutLoop() {
    await this.initPromise;
    while (!this.aborter.isAborted) {
      await this.aborter.abortablePromise(new Promise((r) => setTimeout(r, deadline)));
      if (this.aborter.isAborted) {
        break;
      }
    }
  }
}
