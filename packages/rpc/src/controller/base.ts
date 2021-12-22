import { Address, BN } from 'ethereumjs-util';
import { Node } from '@rei-network/core';
import { Block, WrappedBlock } from '@rei-network/structure';
import { hexStringToBuffer, hexStringToBN } from '@rei-network/utils';
import { DefaultStateManager as StateManager } from '@gxchain2-ethereumjs/vm/dist/state';
import * as helper from '../helper';
import { FilterSystem } from '../filtersystem';

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
  protected readonly node: Node;
  protected readonly filterSystem: FilterSystem;
  constructor(node: Node, filterSystem: FilterSystem) {
    this.node = node;
    this.filterSystem = filterSystem;
  }

  protected async getBlockNumberByTag(tag: string): Promise<BN> {
    if (tag === 'earliest') {
      return new BN(0);
    } else if (tag === 'latest' || tag === undefined) {
      return this.node.getLatestBlock().header.number.clone();
    } else if (tag === 'pending') {
      return this.node.getLatestBlock().header.number.addn(1);
    } else if (tag.startsWith('0x')) {
      return hexStringToBN(tag);
    } else {
      helper.throwRpcErr('Invalid tag value');
      // for types.
      return new BN(0);
    }
  }

  protected async getBlockByTag(tag: string): Promise<Block> {
    let block!: Block;
    if (tag === 'earliest') {
      block = await this.node.db.getBlock(0);
    } else if (tag === 'latest' || tag === undefined) {
      block = this.node.getLatestBlock();
    } else if (tag === 'pending') {
      block = this.node.getPendingBlock();
    } else if (tag.startsWith('0x')) {
      block = await this.node.db.getBlock(hexStringToBN(tag));
    } else {
      helper.throwRpcErr('Invalid tag value');
    }
    return block;
  }

  protected async getWrappedBlockByTag(tag: string) {
    return new WrappedBlock(await this.getBlockByTag(tag), tag === 'pending');
  }

  protected async getStateManagerByTag(tag: string): Promise<StateManager> {
    if (tag === 'pending') {
      return this.node.getPendingStateManager();
    } else {
      const block = await this.getBlockByTag(tag);
      return this.node.getStateManager(block.header.stateRoot, block.header.number);
    }
  }

  protected async runCall(data: CallData, tag: string | Block) {
    const block = typeof tag === 'string' ? await this.getBlockByTag(tag) : tag;
    const vm = await this.node.getVM(block.header.stateRoot, block.header.number);
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
