import VM from '@gxchain2-ethereumjs/vm';
import Bloom from '@gxchain2-ethereumjs/vm/dist/bloom';
/**
 * WrappedVM contains a evm, responsible for executing an EVM message fully
 * (including any nested calls and creates), processing the results and
 * storing them to state (or discarding changes in case of exceptions).
 */
export class WrappedVM {
  public readonly vm: VM;

  constructor(vm: VM) {
    this.vm = vm;
    // TODO: fix this.
    this.vm._common.removeAllListeners('hardforkChanged');
  }
}

export { VM, Bloom };
export * from '@gxchain2-ethereumjs/vm/dist/evm/interpreter';
export * from '@gxchain2-ethereumjs/vm/dist/exceptions';
export * from '@gxchain2-ethereumjs/vm/dist/types';
export { encodeReceipt } from '@gxchain2-ethereumjs/vm/dist/runBlock';
export { DefaultStateManager as StateManager } from '@gxchain2-ethereumjs/vm/dist/state';
