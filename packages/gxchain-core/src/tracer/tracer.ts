import { BN } from 'ethereumjs-util';
import { Block } from '@gxchain2/block';
import { IDebug } from '@gxchain2/vm';
import { Node } from '../node';
import { StructLogDebug } from './debug/structlogdebug';

export interface TracerOptions {
  node: Node;
}

export interface TraceConfig {
  disableStorage?: boolean;
  disableMemory?: boolean;
  disableStack?: boolean;
  tracer?: string;
  timeout?: string;
}

export class Tracer {
  private readonly node: Node;

  constructor(options: TracerOptions) {
    this.node = options.node;
  }

  private createDebugImpl(config: TraceConfig, hash?: Buffer): IDebug {
    return new StructLogDebug(config, hash);
  }

  private debugResult(debug: IDebug) {
    if (debug instanceof StructLogDebug) {
      return debug.result();
    }
    throw new Error('unknow error');
  }

  private async _traceBlock(block: Block, config: TraceConfig, hash?: Buffer) {
    if (block.header.number.eqn(0)) {
      throw new Error('invalid block number, 0');
    }
    const parent = await this.node.db.getBlockByHashAndNumber(block.header.parentHash, block.header.number.subn(1));
    const wvm = await this.node.getWrappedVM(parent.header.stateRoot);
    const debug = this.createDebugImpl(config, hash);
    await wvm.runBlock({ block, debug });
    return this.debugResult(debug);
  }

  async traceBlockByNumber(number: BN, config: TraceConfig) {
    return await this._traceBlock(await this.node.db.getBlock(number), config);
  }

  async traceBlockByHash(hash: Buffer, config: TraceConfig) {
    return await this._traceBlock(await this.node.db.getBlock(hash), config);
  }

  async traceBlock(blockRlp: Buffer, config: TraceConfig) {
    return await this._traceBlock(Block.fromRLPSerializedBlock(blockRlp, { common: this.node.common }), config);
  }

  async traceTx(hash: Buffer, config: TraceConfig) {
    const wtx = await this.node.db.getWrappedTransaction(hash);
    return await this._traceBlock(await this.node.db.getBlockByHashAndNumber(wtx.extension.blockHash!, wtx.extension.blockNumber!), config, hash);
  }
}
