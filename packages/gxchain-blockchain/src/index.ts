import { EventEmitter } from 'events';

import EthereumJSBlockchain from '@ethereumjs/blockchain';

import { Block, BlockHeader } from '@gxchain2/block';

interface Constructor<T = {}> {
  new (...args: any[]): T;
}

declare function mixin<T1 extends Constructor, T2 extends Constructor>(mix1: T1, mix2: T2): new (...args) => InstanceType<T1> & InstanceType<T2>;

export declare interface Blockchain {
  on(event: 'updated', listener: (block: Block) => void): this;
}

export class Blockchain extends mixin(EthereumJSBlockchain, EventEmitter) {
  private _latestBlock!: Block;

  get latestBlock() {
    return this._latestBlock;
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
