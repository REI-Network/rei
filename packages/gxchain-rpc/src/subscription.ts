import { uuidv4 } from 'uuid';
import { Aborter, FunctionalMap, createBufferFunctionalMap } from '@gxchain2/utils';
import { createBrotliDecompress } from 'node:zlib';
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
type filter = {
  typ: string;
  lifetime: number;
  hashes: Buffer[];
  logs: Buffer[];
  s: Subscription;
};

class Filters {
  private aborter = new Aborter();

  private readonly initPromise: Promise<void>;

  private readonly pendingMap: FunctionalMap<Buffer, filter>;
  private readonly logMap: FunctionalMap<Buffer, filter>;
  private readonly HeadMap: FunctionalMap<Buffer, filter>;

  constructor() {
    this.initPromise = this.init();
    this.pendingMap = createBufferFunctionalMap<filter>();
    this.HeadMap = createBufferFunctionalMap<filter>();
    this.logMap = createBufferFunctionalMap<filter>();

    this.timeoutLoop();
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
      for (const [addr, filter] of this.pendingMap) {
        if (Date.now() - filter.lifetime > deadline) {
          this.pendingMap.delete(addr);
        }
      }
    }
  }
}
