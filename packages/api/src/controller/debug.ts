import { hexStringToBuffer } from '@rei-network/utils';
import { CallData } from '../types';
import { Controller } from './base';

/**
 * Debug api Controller
 */
export class DebugController extends Controller {
  /**
   * Trace a block by blockrlp data
   * @param blockRlp - block rlp encoded data
   * @param options - options
   * @returns Result of execution block
   */
  traceBlock([blockRlp, options]: [string, any]) {
    return this.node.getTracer().traceBlock(hexStringToBuffer(blockRlp), options);
  }

  /**
   * Trace a block by block number
   * @param tag - block tag
   * @param options - options
   * @returns Result of execution block
   */
  async traceBlockByNumber([tag, options]: [string, any]) {
    return this.node.getTracer().traceBlock(await this.getBlockByTag(tag), options);
  }

  /**
   * Trace a block by block hash
   * @param hash  - block hash
   * @param options - options
   * @returns Result of execution block
   */
  traceBlockByHash([hash, options]: [string, any]) {
    return this.node.getTracer().traceBlockByHash(hexStringToBuffer(hash), options);
  }

  /**
   * Trace a transaction by transaction hash
   * @param hash - transaction hash
   * @param options - options
   * @returns Result of execution transaction
   */
  traceTransaction([hash, options]: [string, any]) {
    return this.node.getTracer().traceTx(hexStringToBuffer(hash), options);
  }

  /**
   * Trace given transaction by call vm.runCall fucntion
   * @param data - call data
   * @param tag - block tag
   * @param options - options
   * @returns Result of execution transaction
   */
  async traceCall([data, tag, options]: [CallData, string, any]) {
    return this.node.getTracer().traceCall(data, await this.getBlockByTag(tag), options);
  }
}
