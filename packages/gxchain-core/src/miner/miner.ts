import { hexStringToBN, hexStringToBuffer, AsyncChannel, logger } from '@gxchain2/utils';
import { Worker } from './worker';
import { Loop } from './loop';
import { Node } from '../node';
import { Address, BN, bufferToHex } from 'ethereumjs-util';

export interface MinerOptions {
  coinbase: string;
  mineInterval: number;
  gasLimit: string;
}

export class Miner extends Loop {
  public readonly worker: Worker;

  private _coinbase: Buffer;
  private _gasLimit: BN;
  private readonly node: Node;
  private readonly initPromise: Promise<void>;
  private readonly options?: MinerOptions;
  private readonly controlQueue = new AsyncChannel<boolean>({ max: 1, isAbort: () => this.aborter.isAborted });

  constructor(node: Node, options?: MinerOptions) {
    super(options?.mineInterval || 5000);
    this.node = node;
    this.options = options;
    this._coinbase = this?.options?.coinbase ? hexStringToBuffer(this.options.coinbase) : Address.zero().buf;
    this._gasLimit = this?.options?.gasLimit ? hexStringToBN(this.options.gasLimit) : hexStringToBN('0xbe5c8b');
    this.worker = new Worker(node, this);
    this.initPromise = this.init();
    node.sync.on('start synchronize', () => {
      this.controlQueue.push(false);
    });
    node.sync.on('synchronized', () => {
      this.controlQueue.push(true);
    });
    node.sync.on('synchronize failed', () => {
      this.controlQueue.push(true);
    });
    this.controlLoop();
  }

  get isMining() {
    return !!this.options;
  }

  get coinbase() {
    return this._coinbase;
  }

  get gasLimit() {
    return this._gasLimit;
  }

  private async controlLoop() {
    await this.initPromise;
    for await (const flag of this.controlQueue.generator()) {
      if (flag) {
        await this.worker.startLoop();
        await this.startLoop();
      } else {
        await this.worker.stopLoop();
        await this.stopLoop();
      }
    }
  }

  setCoinbase(coinbase: string | Buffer) {
    this._coinbase = typeof coinbase === 'string' ? hexStringToBuffer(coinbase) : coinbase;
  }

  setGasLimit(gasLimit: string | BN) {
    this._gasLimit = typeof gasLimit === 'string' ? hexStringToBN(gasLimit) : gasLimit;
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
      await this.initPromise;
      await super.startLoop();
    }
  }

  async mineBlock() {
    const block = await this.worker.getPendingBlock();
    if (block.header.number.eq(this.node.blockchain.latestBlock.header.number.addn(1)) && block.header.parentHash.equals(this.node.blockchain.latestBlock.hash())) {
      const newBlock = await this.node.processBlock(block);
      await this.node.newBlock(newBlock);
      logger.info('⛏️  Mine block, height:', newBlock.header.number.toString(), 'hash:', bufferToHex(newBlock.hash()));
    } else {
      logger.warn('Miner::mineBlock, invalid pending block:', bufferToHex(block.hash()), 'latest:', bufferToHex(this.node.blockchain.latestBlock.hash()));
    }
  }

  protected async process() {
    try {
      await this.mineBlock();
    } catch (err) {
      logger.error('Miner::process, catch error:', err);
    }
  }
}
