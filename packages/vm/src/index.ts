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

  /**
   * The method call the runBlock method and redirect it to the vm
   * @param opts Options for running block.
   * @returns
   */
  async runBlock(opts: RunBlockDebugOpts): Promise<RunBlockResult> {
    await this.vm.init();
    return runBlock.bind(this.vm)(opts);
  }

  /**
   * The method call the runCall method and redirect it to the vm
   * @param opts Options for running call.
   * @returns
   */
  async runCall(opts: RunCallDebugOpts) {
    await this.vm.init();
    return runCall.bind(this.vm)(opts);
  }
}

export { VM, Bloom };
export * from '@ethereumjs/vm/dist/evm/interpreter';
export * from '@ethereumjs/vm/dist/exceptions';
export * from './types';
export { DefaultStateManager as StateManager } from '@ethereumjs/vm/dist/state';
