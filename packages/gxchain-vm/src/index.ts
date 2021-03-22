import VM from '@ethereumjs/vm';
import Bloom from '@ethereumjs/vm/dist/bloom';
import runBlock, { RunBlockOpts, RunBlockResult } from './runBlock';

export class WrappedVM {
  public readonly vm: VM;

  constructor(vm: VM) {
    this.vm = vm;
  }

  async runBlock(opts: RunBlockOpts): Promise<RunBlockResult> {
    await this.vm.init();
    return runBlock.bind(this.vm)(opts);
  }
}

export { VM, Bloom };
