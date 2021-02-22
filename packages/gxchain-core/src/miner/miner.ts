import { hexStringToBuffer } from '@gxchain2/utils';
import { Worker } from './worker';
import { Node } from '../node';

export interface MinerOptions {
  coinbase: string;
  mineInterval: number;
  gasLimit: string;
}

export class Miner {
  private readonly woker: Worker;
  private readonly initPromise: Promise<void>;
  private readonly options?: MinerOptions;

  constructor(node: Node, options?: MinerOptions) {
    this.options = options;
    this.woker = new Worker(node, this);
    this.initPromise = this.init();
    node.sync.on('start synchronize', () => {
      this.woker.stopRecommitLoop();
    });
    node.sync.on('synchronized', () => {
      this.woker.startRecommitLoop();
    });
    node.sync.on('synchronize failed', () => {
      this.woker.startRecommitLoop();
    });
  }

  get coinbase(): Buffer | undefined {
    const coinbase = this?.options?.coinbase;
    return coinbase ? hexStringToBuffer(coinbase) : undefined;
  }

  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    await this.woker.init();
  }
}
