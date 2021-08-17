import { hexStringToBuffer } from '@gxchain2/utils';
import { Tracer, TraceConfig } from '@gxchain2/core';
import { Controller, CallData } from './base';

export class DebugController extends Controller {
  debug_traceBlock([blockRlp, options]: [string, undefined | TraceConfig]) {
    return new Tracer(this.node).traceBlock(hexStringToBuffer(blockRlp), options);
  }
  async debug_traceBlockByNumber([tag, options]: [string, undefined | TraceConfig]) {
    return new Tracer(this.node).traceBlock(await this.getBlockByTag(tag), options);
  }
  debug_traceBlockByHash([hash, options]: [string, undefined | TraceConfig]) {
    return new Tracer(this.node).traceBlockByHash(hexStringToBuffer(hash), options);
  }
  debug_traceTransaction([hash, options]: [string, undefined | TraceConfig]) {
    return new Tracer(this.node).traceTx(hexStringToBuffer(hash), options);
  }
  async debug_traceCall([data, tag, options]: [CallData, string, undefined | TraceConfig]) {
    return new Tracer(this.node).traceCall(data, await this.getBlockByTag(tag), options);
  }
}
