# @gxchain2/vm
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/vm)](https://www.npmjs.org/package/@gxchain2/vm)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/vm)](https://packagephobia.now.sh/result?p=@gxchain2/vm)
![License](https://img.shields.io/npm/l/@gxchain2/vm)


Virtual machine based on `@ethereumjs/vm`, added logic about `runblock` and `runcall`
- `run block` The debug function in vm, the options inncluding:
  
   - `captureStart` Called when the transaction starts processing.
  
   - `captureState` Called at every step of processing a transaction.
  
   - `captureFault` Called when a transaction processing error.
   - `captureEnd`   Called when the transaction is processed

## INSTALL

```sh
npm install @gxchain2/vm
```
## STRUCTURE
```ts
/**
 * WrappedVM contains a evm, responsible for executing an EVM message fully
 * (including any nested calls and creates), processing the results and
 * storing them to state (or discarding changes in case of exceptions).
 */
export declare class WrappedVM {
    readonly vm: VM;
    constructor(vm: VM);
    /**
     * The method call the runBlock method and redirect it to the vm
     * @param opts Options for running block.
     * @returns
     */
    runBlock(opts: RunBlockDebugOpts): Promise<RunBlockResult>;
    /**
     * The method call the runCall method and redirect it to the vm
     * @param opts Options for running call.
     * @returns
     */
    runCall(opts: RunCallDebugOpts): Promise<import("@ethereumjs/vm/dist/evm/evm").EVMResult>;
}
```

## USAGE

```ts
wrappedvm = new WrappedVM(
new VM({
  common: stateManager._common,
  stateManager,
  blockchain: blockchain
})

wrappedvm.runBlock({ block, debug, skipBlockValidation: true }) //run block to debug

```
## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
