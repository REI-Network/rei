import type { JSEVMBinding } from '@rei-network/binding';

let inited = false;

export function createBinding(exposed: any, chainId: number) {
  const { JSEVMBinding: Binding, init }: { JSEVMBinding: typeof JSEVMBinding; init: () => void } = require('@rei-network/binding');
  if (!inited) {
    // init c++ binding
    inited = true;
    init();
  }
  // create instance
  return new Binding(exposed, chainId);
}
