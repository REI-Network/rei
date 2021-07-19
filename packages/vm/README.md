# @gxchain2/vm

[![NPM Version](https://img.shields.io/npm/v/@gxchain2/vm)](https://www.npmjs.org/package/@gxchain2/vm)
![License](https://img.shields.io/npm/l/@gxchain2/vm)

Virtual machine based on `@ethereumjs/vm`, added debug logic for `runBlock` and `runCall`

## INSTALL

```sh
npm install @gxchain2/vm
```

## USAGE

```ts
const wvm = new WrappedVM(
  new VM({
    common: common,
    stateManager: stateManager,
    blockchain: blockchain
});

wvm.runBlock({
  block,
  skipBlockValidation: true,
  debug: {
    async captureStart(from: undefined | Buffer) {
      console.log('captureStart, from:', from ? bufferToHex(from) : null);
    },

    async captureState(step: InterpreterStep, cost: BN) {
      console.log('captureState, cost:', cost.toNumber());
    },

    async captureFault(step: InterpreterStep, cost: BN, err: any) {
      console.log('captureFault, error:', err);
    },

    async captureEnd(output: Buffer, gasUsed: BN, time: number) {
      console.log('captureEnd, gasUsed:', gasUsed.toNumber());
    }
  }
});
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
