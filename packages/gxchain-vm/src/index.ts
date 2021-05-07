import VM from '@ethereumjs/vm';
import Bloom from '@ethereumjs/vm/dist/bloom';
import runBlock, { RunBlockDebugOpts, RunBlockResult } from './runBlock';
import runCall, { RunCallDebugOpts } from './runCall';

export class WrappedVM {
  public readonly vm: VM;

  constructor(vm: VM) {
    this.vm = vm;
    // TODO: fix this.
    this.vm._common.removeAllListeners('hardforkChanged');
  }

  async runBlock(opts: RunBlockDebugOpts): Promise<RunBlockResult> {
    await this.vm.init();
    return runBlock.bind(this.vm)(opts);
  }

  async runCall(opts: RunCallDebugOpts) {
    await this.vm.init();
    return runCall.bind(this.vm)(opts);
  }
}

export { VM, Bloom };
export * from '@ethereumjs/vm/dist/evm/interpreter';
export * from '@ethereumjs/vm/dist/exceptions';
export * from './types';
