import { BN } from 'ethereumjs-util';
import { RunCallOpts } from '@gxchain2-ethereumjs/vm/dist/runCall';
import { RunTxOpts } from '@gxchain2-ethereumjs/vm/dist/runTx';
import { MasterSide } from './link';
import { fromRunCallOpts, fromRunTxOpts } from './utils';
import { Handler, RunTxResult, RunCallResult } from './types';

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

  runTx(opts: RunTxOpts, number: BN, root: Buffer): Promise<RunTxResult> {
    return this.request('runTx', fromRunTxOpts(opts, number, root));
  }

  runCall(opts: RunCallOpts, number: BN, root: Buffer): Promise<RunCallResult> {
    return this.request('runCall', fromRunCallOpts(opts, number, root));
  }
}
