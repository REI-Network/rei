import { hexStringToBuffer } from '@gxchain2/utils';
import { Worker } from './worker';
import { Loop } from './loop';
import { Node } from '../node';

export interface MinerOptions {
  coinbase: string;
  mineInterval: number;
  gasLimit: string;
}

export class Miner extends Loop {
  public readonly worker: Worker;
  public coinbase?: Buffer;
  private readonly node: Node;
  private readonly initPromise: Promise<void>;
  private readonly options?: MinerOptions;

  constructor(node: Node, options?: MinerOptions) {
    super(options?.mineInterval || 5000);
    this.node = node;
    this.options = options;
    this.coinbase = this?.options?.coinbase ? hexStringToBuffer(this.options.coinbase) : undefined;
    this.worker = new Worker(node, this);
    this.initPromise = this.init();
    node.sync.on('start synchronize', async () => {
      await this.worker.stopLoop();
      await this.stopLoop();
    });
    node.sync.on('synchronized', async () => {
      await this.worker.startLoop();
      await this.startLoop();
    });
    node.sync.on('synchronize failed', async () => {
      await this.worker.startLoop();
      await this.startLoop();
    });
  }

  get isMining() {
    return !!this.options;
  }

  async setCoinbase(coinbase: string | Buffer) {
    this.coinbase = typeof coinbase === 'string' ? hexStringToBuffer(coinbase) : coinbase;
    await this.worker.newBlock(this.node.blockchain.latestBlock);
  }

  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    await this.worker.init();
  }

  async startLoop() {
    if (this.isMining) {
      await this.init();
      await super.startLoop();
    }
  }

  async mineBlock() {
    const block = await this.worker.getPendingBlock();
    if (block.header.number.eq(this.node.blockchain.latestBlock.header.number.addn(1))) {
      await this.node.newBlock(await this.node.processBlock(block));
    } else {
      console.debug('Miner, process, unkonw error, invalid height');
    }
  }

  protected async process() {
    try {
      await this.mineBlock();
    } catch (err) {
      console.error('Miner, process, error:', err);
    }
  }
}
