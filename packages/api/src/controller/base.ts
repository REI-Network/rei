import { Address, BN } from 'ethereumjs-util';
import { AbiCoder } from '@ethersproject/abi';
import { Block } from '@rei-network/structure';
import { hexStringToBuffer, hexStringToBN } from '@rei-network/utils';
import { StateManager } from '@rei-network/core';
import { ERROR } from '@rei-network/vm/dist/exceptions';
import { CallData } from '../types';
import { ApiServer } from '../apiServer';

const coder = new AbiCoder();
const revertErrorSelector = Buffer.from('08c379a0', 'hex');

export class RevertError {
  readonly returnValue: string | Buffer;
  readonly decodedReturnValue?: string;

  constructor(returnValue: Buffer | string) {
    this.returnValue = returnValue;
    if (Buffer.isBuffer(returnValue)) {
      this.decodedReturnValue = coder.decode(['string'], returnValue.slice(4))[0];
    }
  }
}

export class OutOfGasError {
  readonly gas: BN;

  constructor(gas: BN) {
    this.gas = gas.clone();
  }
}

export class Controller {
  protected readonly server: ApiServer;

  constructor(server: ApiServer) {
    this.server = server;
  }

  get node() {
    return this.server.node;
  }

  get filterSystem() {
    return this.server.filterSystem;
  }

  get oracle() {
    return this.server.oracle;
  }

  get rpcServer() {
    return this.server.rpcServer;
  }

  protected async getBlockNumberByTag(tag: any): Promise<BN> {
    if (tag === 'earliest') {
      return new BN(0);
    } else if (tag === 'latest' || tag === undefined) {
      return this.node.getLatestBlock().header.number.clone();
    } else if (tag === 'pending') {
      return this.node.getLatestBlock().header.number.addn(1);
    } else if (tag.startsWith('0x')) {
      return hexStringToBN(tag);
    } else {
      throw new Error('Invalid tag value');
    }
  }

  protected async getBlockByTag(tag: any): Promise<Block> {
    let block!: Block;
    if (typeof tag === 'string') {
      if (tag === 'earliest') {
        block = await this.node.db.getBlock(0);
      } else if (tag === 'latest') {
        block = this.node.getLatestBlock();
      } else if (tag === 'pending') {
        block = this.node.getPendingBlock();
      } else if (tag.startsWith('0x')) {
        block = await this.node.db.getBlock(hexStringToBN(tag));
      } else {
        throw new Error('Invalid tag value');
      }
    } else if (typeof tag === 'object') {
      if ('blockNumber' in tag) {
        block = await this.node.db.getBlock(hexStringToBN(tag.blockNumber));
      } else if ('blockHash' in tag) {
        block = await this.node.db.getBlock(hexStringToBuffer(tag.blockHash));
      } else {
        throw new Error('Invalid tag value');
      }
    } else if (tag === undefined) {
      block = this.node.getLatestBlock();
    } else {
      throw new Error('Invalid tag value');
    }
    return block;
  }

  protected async getStateManagerByTag(tag: any): Promise<StateManager> {
    if (tag === 'pending') {
      return this.node.getPendingStateManager();
    } else {
      const block = await this.getBlockByTag(tag);
      return this.node.getStateManager(block.header.stateRoot, block.header.number);
    }
  }

  protected async runCall(data: CallData, tag: any) {
    const block = tag instanceof Block ? tag : await this.getBlockByTag(tag);
    const gas = data.gas ? hexStringToBN(data.gas) : new BN(0xffffff);
    const vm = await this.node.getVM(block.header.stateRoot, block.header.number);
    await vm.stateManager.checkpoint();
    try {
      const result = await vm.runCall({
        block: block as any,
        gasPrice: data.gasPrice ? hexStringToBN(data.gasPrice) : undefined,
        origin: data.from ? Address.fromString(data.from) : Address.zero(),
        caller: data.from ? Address.fromString(data.from) : Address.zero(),
        gasLimit: data.gas ? hexStringToBN(data.gas) : undefined,
        to: data.to ? Address.fromString(data.to) : undefined,
        value: data.value ? hexStringToBN(data.value) : undefined,
        data: data.data ? hexStringToBuffer(data.data) : undefined
      });

      // handling specific types of errors
      const error = result.execResult.exceptionError;
      if (error) {
        if (error.error === ERROR.OUT_OF_GAS) {
          throw new OutOfGasError(gas);
        } else if (error.error === ERROR.REVERT) {
          const returnValue = result.execResult.returnValue;
          if (returnValue.length > 4 && returnValue.slice(0, 4).equals(revertErrorSelector)) {
            throw new RevertError(returnValue);
          } else {
            throw new RevertError('unknown error');
          }
        } else {
          throw error;
        }
      }

      await vm.stateManager.revert();
      return result;
    } catch (err) {
      await vm.stateManager.revert();
      throw err;
    }
  }
}
