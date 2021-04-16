import { Block } from '@gxchain2/block';
import { IDebug } from '@gxchain2/vm';
import { Node } from '../node';
import { StructLogDebug } from './debug';

export interface TraceConfig {
  disableStorage?: boolean;
  disableMemory?: boolean;
  disableStack?: boolean;
  tracer?: string;
  timeout?: string;
}

export class Tracer {
  private readonly node: Node;

  constructor(node: Node) {
    this.node = node;
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

  async traceBlock(block: Block | Buffer, config: TraceConfig, hash?: Buffer) {
    block = block instanceof Block ? block : Block.fromRLPSerializedBlock(block, { common: this.node.common });
    if (block.header.number.eqn(0)) {
      throw new Error('invalid block number, 0');
    }
    const parent = await this.node.db.getBlockByHashAndNumber(block.header.parentHash, block.header.number.subn(1));
    const wvm = await this.node.getWrappedVM(parent.header.stateRoot);
    const debug = this.createDebugImpl(config, hash);
    await wvm.runBlock({ block, debug });
    return this.debugResult(debug);
  }

  async traceBlockByHash(hash: Buffer, config: TraceConfig) {
    return await this.traceBlock(await this.node.db.getBlock(hash), config);
  }

  async traceTx(hash: Buffer, config: TraceConfig) {
    const wtx = await this.node.db.getWrappedTransaction(hash);
    return await this.traceBlock(await this.node.db.getBlockByHashAndNumber(wtx.extension.blockHash!, wtx.extension.blockNumber!), config, hash);
  }
}
