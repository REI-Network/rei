import { hexStringToBuffer } from '@rei-network/utils';
import { ApiServer, CallData } from '@rei-network/api';

/**
 * Debug api Controller
 */
export class DebugController {
  readonly apiServer: ApiServer;

  constructor(apiServer: ApiServer) {
    this.apiServer = apiServer;
  }

  /**
   * Trace a block by blockrlp data
   * @param blockRlp - block rlp encoded data
   * @param options - options
   * @returns Result of execution block
   */
  traceBlock([blockRlp, options]: [string, any]) {
    const blockRlpBuffer = hexStringToBuffer(blockRlp);
    return this.apiServer.traceBlock(blockRlpBuffer, options);
  }

  /**
   * Trace a block by block number
   * @param tag - block tag
   * @param options - options
   * @returns Result of execution block
   */
  async traceBlockByNumber([tag, options]: [string, any]) {
    return this.apiServer.traceBlockByNumber(tag, options);
  }

  /**
   * Trace a block by block hash
   * @param hash  - block hash
   * @param options - options
   * @returns Result of execution block
   */
  traceBlockByHash([hash, options]: [string, any]) {
    return this.apiServer.traceBlockByHash(hash, options);
  }

  /**
   * Trace a transaction by transaction hash
   * @param hash - transaction hash
   * @param options - options
   * @returns Result of execution transaction
   */
  traceTransaction([hash, options]: [string, any]) {
    return this.apiServer.traceTransaction(hash, options);
  }

  /**
   * Trace given transaction by call vm.runCall fucntion
   * @param data - call data
   * @param tag - block tag
   * @param options - options
   * @returns Result of execution transaction
   */
  async traceCall([data, tag, options]: [CallData, string, any]) {
    return this.apiServer.traceCall(data, tag, options);
  }
}
