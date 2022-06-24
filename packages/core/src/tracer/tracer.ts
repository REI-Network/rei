import util from 'util';
import { Address } from 'ethereumjs-util';
import { Block } from '@rei-network/structure';
import { Common } from '@rei-network/common';
import { IDebug } from '@rei-network/vm/dist/types';
import { hexStringToBN, hexStringToBuffer } from '@rei-network/utils';
import { Node } from '../node';
import { EMPTY_ADDRESS } from '../utils';
import { StructLogDebug, JSDebug } from './debug';
import { toAsync } from './toAsync';
import { tracers } from './tracers';

export interface IDebugImpl extends IDebug {
  result(): any;
}

export interface TraceConfig {
  disableStorage?: boolean;
  disableMemory?: boolean;
  disableStack?: boolean;
  tracer?: string;
  timeout?: string;
  // Use ast to convert synchronous functions to asynchronous, default `true`.
  toAsync?: boolean;
  // The number of running vm scripts in batches, default 500.
  vmScriptsBatchSize?: number;
}

/**
 * Tracer provides an implementation of Tracer that evaluates a Javascript
 * function for each VM execution step.
 */
export class Tracer {
  private readonly node: Node;

  constructor(node: Node) {
    this.node = node;
  }

  /**
   * Select the debug mode and generate the debug instance
   * @param reject Reject function
   * @param config Trace Config
   * @param hash Transaction hash
   * @returns Debug instance
   */
  private createDebugImpl(common: Common, reject: (reason?: any) => void, config?: TraceConfig, hash?: Buffer): IDebugImpl {
    if (config?.tracer) {
      if (tracers.has(config.tracer)) {
        config.tracer = tracers.get(config.tracer)!;
        config.toAsync = true;
      }
      config.tracer = config.toAsync === false ? `const obj = ${config.tracer}` : toAsync(`const obj = ${config.tracer}`);
      return new JSDebug(common, config, reject, hash);
    } else {
      return new StructLogDebug(config, hash);
    }
  }

  /**
   * TraceBlock achieve to trace the block again by building a vm,
   * run the block in it, and return result of execution
   * @param block Block object
   * @param config Trace config
   * @param hash
   * @returns Result of execution
   */
  traceBlock(block: Block | Buffer, config?: TraceConfig, hash?: Buffer) {
    block = block instanceof Block ? block : Block.fromRLPSerializedBlock(block, { common: this.node.getCommon(0), hardforkByBlockNumber: true });
    if (block.header.number.eqn(0)) {
      throw new Error('invalid block number, 0');
    }

    const executor = this.node.getExecutor(block._common);
    return new Promise<any>(async (resolve, reject) => {
      try {
        block = block as Block;
        const debug = this.createDebugImpl(block._common, reject, config, hash);
        await executor.processBlock({ debug, block, force: true, skipConsensusValidation: true, skipConsensusVerify: true });
        const result = debug.result();
        resolve(util.types.isPromise(result) ? await result : result);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * TraceBlockByHash call the traceBlock by using the block hash
   * @param hash Block hash
   * @param config Trace config
   * @returns Result of execution
   */
  async traceBlockByHash(hash: Buffer, config?: TraceConfig) {
    return await this.traceBlock(await this.node.db.getBlock(hash), config);
  }

  /**
   * traceTx trace a transaction by trace a block which the
   * transaction belong to
   * @param hash Transaction hash
   * @param config Trace config
   * @returns Result of execution
   */
  async traceTx(hash: Buffer, config?: TraceConfig) {
    const tx = await this.node.db.getTransaction(hash);
    return await this.traceBlock(await this.node.db.getBlockByHashAndNumber(tx.extension!.blockHash, tx.extension!.blockNumber), config, hash);
  }

  /**
   * traceCall trace given transaction by call vm.runCall fucntion
   * @param data Given data
   * @param block Block object
   * @param config Trace config
   * @returns Result of execution
   */
  async traceCall(
    data: {
      from?: string;
      to?: string;
      gas?: string;
      gasPrice?: string;
      value?: string;
      data?: string;
    },
    block: Block,
    config?: TraceConfig
  ) {
    if (block.header.number.eqn(0)) {
      throw new Error('invalid block number, 0');
    }

    return new Promise<any>(async (resolve, reject) => {
      try {
        const parent = await this.node.db.getBlockByHashAndNumber(block.header.parentHash, block.header.number.subn(1));
        const vm = await this.node.getVM(parent.header.stateRoot, block.header.number.subn(1));
        const debug = this.createDebugImpl(block._common, reject, config);
        await vm.runCall({
          block,
          debug,
          gasPrice: data.gasPrice ? hexStringToBN(data.gasPrice) : undefined,
          origin: data.from ? Address.fromString(data.from) : EMPTY_ADDRESS,
          caller: data.from ? Address.fromString(data.from) : EMPTY_ADDRESS,
          gasLimit: data.gas ? hexStringToBN(data.gas) : undefined,
          to: data.to ? Address.fromString(data.to) : undefined,
          value: data.value ? hexStringToBN(data.value) : undefined,
          data: data.data ? hexStringToBuffer(data.data) : undefined
        });
        const result = debug.result();
        resolve(util.types.isPromise(result) ? await result : result);
      } catch (err) {
        reject(err);
      }
    });
  }
}
