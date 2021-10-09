import { Address, BN } from 'ethereumjs-util';
import { Node } from '@gxchain2/core';
import { Block, WrappedBlock } from '@gxchain2/structure';
import { hexStringToBuffer, hexStringToBN, logger } from '@gxchain2/utils';
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
      return this.node.blockchain.latestBlock.header.number.clone();
    } else if (tag === 'pending') {
      return this.node.blockchain.latestBlock.header.number.addn(1);
    } else if (Number.isInteger(Number(tag))) {
      return new BN(tag);
    } else {
      helper.throwRpcErr('Invalid tag value');
      // for types.
      return new BN(0);
    }
  }

  protected async getBlockByTag(tag: string): Promise<Block> {
    let block!: Block;
    if (tag === 'earliest') {
      block = await this.node.blockchain.getBlock(0);
    } else if (tag === 'latest' || tag === undefined) {
      block = this.node.blockchain.latestBlock;
    } else if (tag === 'pending') {
      block = this.node.getLastestEngine().getLastPendingBlock();
    } else if (Number.isInteger(Number(tag))) {
      block = await this.node.blockchain.getBlock(Number(tag));
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
      // return await this.node.miner.getPendingStateManager();
      return undefined as any;
    } else {
      const block = await this.getBlockByTag(tag);
      return this.node.getStateManager(block.header.stateRoot, block.header.number);
    }
  }

  protected calculateBaseFee(data: CallData, num: BN) {
    const common = this.node.getCommon(num);
    const txDataZero = common.param('gasPrices', 'txDataZero');
    const txDataNonZero = common.param('gasPrices', 'txDataNonZero');
    let cost = 0;
    if (data.data) {
      const buf = hexStringToBuffer(data.data);
      for (let i = 0; i < data.data.length; i++) {
        buf[i] === 0 ? (cost += txDataZero) : (cost += txDataNonZero);
      }
    }
    const fee = new BN(cost).addn(common.param('gasPrices', 'tx'));
    if (common.gteHardfork('homestead') && (data.to === undefined || hexStringToBuffer(data.to).length === 0)) {
      fee.iaddn(common.param('gasPrices', 'txCreation'));
    }
    return fee;
  }

  protected async runCall(data: CallData, tag: string) {
    const block = await this.getBlockByTag(tag);
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
      result.gasUsed.iadd(this.calculateBaseFee(data, block.header.number));
      return result;
    } catch (err) {
      await vm.stateManager.revert();
      logger.warn('Controller::runCall, catch error:', err);
      throw err;
    }
  }
}
