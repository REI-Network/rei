import { Address, BN } from 'ethereumjs-util';
import { Block } from '@rei-network/structure';
import { MasterSide } from './link';
import { fromCommitBlockOpts, fromFinalizeOpts, fromProcessBlockOpts, fromProcessTxOpts, toCommitBlockResult, toFinalizeResult, toProcessBlockResult, toProcessTxResult } from './utils';
import { FinalizeOpts, ProcessBlockOpts, ProcessTxOpts } from '../executor/types';
import { EvidenceFactory } from '../consensus/reimint/types';
import { Handler, CommitBlockOpts } from './types';
import { Node } from '../node';

const handlers = new Map<string, Handler>([
  [
    'checkEvidence',
    async function (this: VMMaster, evidence: Buffer[]) {
      await this.node.evpool.checkEvidence(evidence.map((ev) => EvidenceFactory.fromSerializedEvidence(ev)));
    }
  ]
]);

export class VMMaster extends MasterSide {
  readonly node: Node;

  constructor(pathToWorker: string, node: Node) {
    super(pathToWorker, handlers);
    this.node = node;
  }

  //// levelDB ////

  put(...args: any[]) {
    return this.request('put', args);
  }

  get(...args: any[]) {
    return this.request('get', args);
  }

  del(...args: any[]) {
    return this.request('del', args);
  }

  batch(...args: any[]) {
    return this.request('batch', args);
  }

  //// VM ////

  async finalize(opts: FinalizeOpts) {
    const result = await this.request('finalize', fromFinalizeOpts(opts));
    return toFinalizeResult(result);
  }

  async processBlock(opts: ProcessBlockOpts) {
    const result = await this.request('processBlock', fromProcessBlockOpts(opts));
    return toProcessBlockResult(result);
  }

  async processTx(opts: ProcessTxOpts) {
    const result = await this.request('processTx', fromProcessTxOpts(opts));
    return toProcessTxResult(result);
  }

  async commitBlock(opts: CommitBlockOpts) {
    const result = await this.request('commitBlock', fromCommitBlockOpts(opts));
    return toCommitBlockResult(result);
  }

  //// Blockchain ////

  async latestBlock() {
    const result = await this.request('latestBlock', undefined);
    const common = this.node.getCommon(0);
    return Block.fromRLPSerializedBlock(result, { common, hardforkByBlockNumber: true });
  }

  async totalDifficulty(hash: Buffer, number: BN) {
    const result = await this.request('totalDifficulty', {
      hash,
      number: number.toArrayLike(Buffer)
    });
    return new BN(result);
  }

  async cliqueActiveSignersByBlockNumber(number: BN) {
    const result: Buffer[] = await this.request('cliqueActiveSignersByBlockNumber', {
      number: number.toArrayLike(Buffer)
    });
    return result.map((signer) => new Address(signer));
  }

  async cliqueCheckNextRecentlySigned(number: BN, signer: Address) {
    const result = await this.request('cliqueCheckNextRecentlySigned', {
      number: number.toArrayLike(Buffer),
      signer: signer.buf
    });
    return result;
  }
}
