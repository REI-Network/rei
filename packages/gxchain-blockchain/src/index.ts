import { EventEmitter } from 'events';

import EthereumJSBlockchain, { BlockchainOptions } from '@ethereumjs/blockchain';

import { Block, BlockHeader } from '@gxchain2/block';
import { mixin } from '@gxchain2/utils';

export declare interface Blockchain {
  on(event: 'updated', listener: (block: Block) => void): this;
}

export class Blockchain extends mixin(EthereumJSBlockchain, EventEmitter) {
  private _latestBlock!: Block;

  constructor(opts: BlockchainOptions = {}) {
    super(opts);

    // TODO: pretty this.
    this.updateLatest();
  }

  get latestBlock() {
    return this._latestBlock;
  }

  get latestHeight() {
    return this?._latestBlock?.header?.number?.toNumber() || 0;
  }

  get latestHash() {
    return '0x' + (this?._latestBlock?.header?.hash()?.toString('hex') || '00');
  }

  private async updateLatest() {
    const latestBlock = await this.getLatestBlock();
    if (!this._latestBlock || !latestBlock.header.hash().equals(this._latestBlock.header.hash())) {
      this._latestBlock = latestBlock;
      this.emit('updated', this._latestBlock);
    }
  }

  async putBlock(block: Block) {
    await super.putBlock(block);
    await this.updateLatest();
  }

  async putHeader(header: BlockHeader) {
    await super.putHeader(header);
    await this.updateLatest();
  }
}
