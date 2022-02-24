import { Address, BN } from 'ethereumjs-util';
import { Block, WrappedBlock } from '@rei-network/structure';
import { hexStringToBuffer, hexStringToBN } from '@rei-network/utils';
import { StateManager } from '../types';
import { RpcServer } from '../index';
import * as helper from '../helper';

export type CallData = {
  from?: string;
  to?: string;
  gas?: string;
  gasPrice?: string;
  value?: string;
  data?: string;
  nonce?: string;
};

export class Controller {
  protected readonly server: RpcServer;

  constructor(server: RpcServer) {
    this.server = server;
  }

  get backend() {
    return this.server.backend;
  }

  get filterSystem() {
    return this.server.filterSystem;
  }

  get oracle() {
    return this.server.oracle;
  }

  protected async getBlockNumberByTag(tag: any): Promise<BN> {
    if (tag === 'earliest') {
      return new BN(0);
    } else if (tag === 'latest' || tag === undefined) {
      return this.backend.getLatestBlock().header.number.clone();
    } else if (tag === 'pending') {
      return this.backend.getLatestBlock().header.number.addn(1);
    } else if (tag.startsWith('0x')) {
      return hexStringToBN(tag);
    } else {
      helper.throwRpcErr('Invalid tag value');
      // for types.
      return new BN(0);
    }
  }

  protected async getBlockByTag(tag: any): Promise<Block> {
    let block!: Block;
    if (typeof tag === 'string') {
      if (tag === 'earliest') {
        block = await this.backend.db.getBlock(0);
      } else if (tag === 'latest') {
        block = this.backend.getLatestBlock();
      } else if (tag === 'pending') {
        block = this.backend.getPendingBlock();
      } else if (tag.startsWith('0x')) {
        block = await this.backend.db.getBlock(hexStringToBN(tag));
      } else {
        helper.throwRpcErr('Invalid tag value');
      }
    } else if (typeof tag === 'object') {
      if ('blockNumber' in tag) {
        block = await this.backend.db.getBlock(hexStringToBN(tag.blockNumber));
      } else if ('blockHash' in tag) {
        block = await this.backend.db.getBlock(hexStringToBuffer(tag.blockHash));
      } else {
        helper.throwRpcErr('Invalid tag value');
      }
    } else if (tag === undefined) {
      block = this.backend.getLatestBlock();
    } else {
      helper.throwRpcErr('Invalid tag value');
    }
    return block;
  }

  protected async getWrappedBlockByTag(tag: any) {
    return new WrappedBlock(await this.getBlockByTag(tag), tag === 'pending');
  }

  protected async getStateManagerByTag(tag: any): Promise<StateManager> {
    if (tag === 'pending') {
      return this.backend.getPendingStateManager();
    } else {
      const block = await this.getBlockByTag(tag);
      return this.backend.getStateManager(block.header.stateRoot, block.header.number);
    }
  }

  protected async runCall(data: CallData, tag: any) {
    const block = tag instanceof Block ? tag : await this.getBlockByTag(tag);
    const vm = await this.backend.getVM(block.header.stateRoot, block.header.number);
    await vm.stateManager.checkpoint();
    try {
      const result = await vm.runCall({
        block,
        gasPrice: data.gasPrice ? hexStringToBN(data.gasPrice) : undefined,
        origin: data.from ? Address.fromString(data.from) : Address.zero(),
        caller: data.from ? Address.fromString(data.from) : Address.zero(),
        gasLimit: data.gas ? hexStringToBN(data.gas) : undefined,
        to: data.to ? Address.fromString(data.to) : undefined,
        value: data.value ? hexStringToBN(data.value) : undefined,
        data: data.data ? hexStringToBuffer(data.data) : undefined
      });
      if (result.execResult.exceptionError) {
        throw result.execResult.exceptionError;
      }
      await vm.stateManager.revert();
      return result;
    } catch (err) {
      await vm.stateManager.revert();
      throw err;
    }
  }
}
