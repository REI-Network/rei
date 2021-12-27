import { hexStringToBuffer } from '@rei-network/utils';
import { Controller, CallData } from './base';

export class DebugController extends Controller {
  debug_traceBlock([blockRlp, options]: [string, any]) {
    return this.backend.getTracer().traceBlock(hexStringToBuffer(blockRlp), options);
  }
  async debug_traceBlockByNumber([tag, options]: [string, any]) {
    return this.backend.getTracer().traceBlock(await this.getBlockByTag(tag), options);
  }
  debug_traceBlockByHash([hash, options]: [string, any]) {
    return this.backend.getTracer().traceBlockByHash(hexStringToBuffer(hash), options);
  }
  debug_traceTransaction([hash, options]: [string, any]) {
    return this.backend.getTracer().traceTx(hexStringToBuffer(hash), options);
  }
  async debug_traceCall([data, tag, options]: [CallData, string, any]) {
    return this.backend.getTracer().traceCall(data, await this.getBlockByTag(tag), options);
  }
}
