import { Address, BN, bufferToHex } from 'ethereumjs-util';
import { AbiCoder } from '@ethersproject/abi';
import { Block } from '@rei-network/structure';
import { hexStringToBuffer, hexStringToBN } from '@rei-network/utils';
import { ERROR } from '@rei-network/vm/dist/exceptions';
import { StateManager } from '@rei-network/rpc/src/types';
import { RpcServer } from '@rei-network/rpc/src';
import errors from '@rei-network/rpc/src/errorCodes';
import * as helper from '@rei-network/rpc/src/helper';

const coder = new AbiCoder();

// keccak256("Error(string)").slice(0, 4)
const revertErrorSelector = Buffer.from('08c379a0', 'hex');

export type CallData = {
  from?: string;
  to?: string;
  gas?: string;
  gasPrice?: string;
  value?: string;
  data?: string;
  nonce?: string;
};

export class RevertError {
  readonly code = errors.REVERT_ERROR.code;
  readonly rpcMessage: string;
  readonly data?: string;

  constructor(returnValue: Buffer | string) {
    if (typeof returnValue === 'string') {
      this.rpcMessage = returnValue;
    } else {
      this.rpcMessage = 'execution reverted: ' + coder.decode(['string'], returnValue.slice(4))[0];
      this.data = bufferToHex(returnValue);
    }
  }
}

export class OutOfGasError {
  readonly code = errors.SERVER_ERROR.code;
  readonly gas: BN;

  constructor(gas: BN) {
    this.gas = gas.clone();
  }

  get rpcMessage() {
    return `gas required exceeds allowance (${this.gas.toString()})`;
  }
}

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
    const gas = data.gas ? hexStringToBN(data.gas) : new BN(0xffffff);
    const vm = await this.backend.getVM(block.header.stateRoot, block.header.number);
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
