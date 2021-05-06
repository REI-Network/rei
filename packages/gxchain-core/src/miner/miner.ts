import { hexStringToBN, hexStringToBuffer, Channel, logger } from '@gxchain2/utils';
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

  constructor(node: Node, options?: MinerOptions) {
    super(options?.mineInterval || 5000);
    this.node = node;
    this.options = options;
    this._coinbase = this?.options?.coinbase ? hexStringToBuffer(this.options.coinbase) : Address.zero().buf;
    this._gasLimit = this?.options?.gasLimit ? hexStringToBN(this.options.gasLimit) : hexStringToBN('0xbe5c8b');
    this.worker = new Worker(node, this);
    this.initPromise = this.init();
    node.sync.on('start synchronize', () => {
      this.worker.stopLoop();
      this.stopLoop();
    });
    node.sync.on('synchronized', () => {
      this.worker.startLoop();
      this.startLoop();
    });
    node.sync.on('synchronize failed', () => {
      this.worker.startLoop();
      this.startLoop();
    });
  }

  /**
   * Get the mining state
   */
  get isMining() {
    return !!this.options;
  }

  /**
   * Get the coinbase
   */
  get coinbase() {
    return this._coinbase;
  }

  /**
   * Get the limit of gas
   */
  get gasLimit() {
    return this._gasLimit;
  }

  /**
   * Set the coinbase
   * @param coinbase
   */
  setCoinbase(coinbase: string | Buffer) {
    this._coinbase = typeof coinbase === 'string' ? hexStringToBuffer(coinbase) : coinbase;
  }

  /**
   * Set the gas limit
   * @param gasLimit
   */
  setGasLimit(gasLimit: string | BN) {
    this._gasLimit = typeof gasLimit === 'string' ? hexStringToBN(gasLimit) : gasLimit;
  }

  /**
   * Initialize the miner
   * @returns
   */
  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    await this.worker.init();
    this.worker.startLoop();
    if (this.isMining) {
      super.startLoop();
    }
  }

  /**
   * Start the loop
   */
  startLoop() {
    if (this.isMining) {
      super.startLoop();
    }
  }

  /**
   * Mine the Block
   */
  async mineBlock() {
    await this.initPromise;
    const lastHeader = this.node.blockchain.latestBlock.header;
    const block = await this.worker.getPendingBlock(lastHeader.number, lastHeader.hash());
    const newBlock = await this.node.processBlock(block);
    await this.node.newBlock(newBlock);
    logger.info('⛏️  Mine block, height:', newBlock.header.number.toString(), 'hash:', bufferToHex(newBlock.hash()));
  }

  protected async process() {
    try {
      await this.mineBlock();
    } catch (err) {
      logger.error('Miner::process, catch error:', err);
    }
  }
}
