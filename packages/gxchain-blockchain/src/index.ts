import EthereumBlockchain, { BlockchainOptions as EthereumBlockchainOptions } from '@ethereumjs/blockchain';
import { Block } from '@gxchain2/block';
import { Database } from '@gxchain2/database';
import { EventEmitter } from 'events';

export interface BlockchainOptions extends EthereumBlockchainOptions {
  database: Database;
}

export declare interface BlockchainEventEmitter {
  on(event: 'updated', listener: (block: Block) => void): this;

  once(event: 'updated', listener: (block: Block) => void): this;
}

export class BlockchainEventEmitter extends EventEmitter {}

export class Blockchain extends EthereumBlockchain {
  event: BlockchainEventEmitter = new BlockchainEventEmitter();
  dbManager: Database;
  private _latestBlock!: Block;

  constructor(opts: BlockchainOptions) {
    super(Object.assign(opts, { validateConsensus: false }));
    this.dbManager = opts.database;
  }

  get latestBlock() {
    return this._latestBlock;
  }

  get latestHeight() {
    return this._latestBlock?.header?.number?.toNumber() || 0;
  }

  get latestHash() {
    return '0x' + (this._latestBlock?.header?.hash()?.toString('hex') || '00');
  }

  private async updateLatest() {
    const latestBlock = await this.getLatestBlock();
    if (!this._latestBlock || !latestBlock.header.hash().equals(this._latestBlock.header.hash())) {
      this._latestBlock = latestBlock;
      this.event.emit('updated', this._latestBlock);
    }
  }

  async init() {
    await this.initPromise;
    this._latestBlock = await this.getLatestBlock();
  }

  async putBlock(block: Block) {
    await super.putBlock(block);
    await this.updateLatest();
  }

  private validatePOA(block: Block): boolean {
    if (block.isGenesis()) {
      return true;
    }
    const self: any = this;
    const coinbase = block.header.coinbase.buf;
    if (!self._common.isValidPOA(coinbase)) {
      return false;
    }
    // TODO: validateSignature.
    return true;
  }
}
