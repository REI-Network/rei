import { MasterSide } from './link';
import { fromCommitBlockOpts, fromFinalizeOpts, fromProcessBlockOpts, fromProcessTxOpts, toCommitBlockResult, toFinalizeResult, toProcessBlockResult, toProcessTxResult } from './utils';
import { Handler, CommitBlockOpts } from './types';
import { FinalizeOpts, ProcessBlockOpts, ProcessTxOpts } from '../executor';

const handlers = new Map<string, Handler>();

export class VMMaster extends MasterSide {
  constructor(pathToWorker: string) {
    super(pathToWorker, handlers);
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
}
