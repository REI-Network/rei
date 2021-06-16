# @gxchain2/vm
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/vm)](https://www.npmjs.org/package/@gxchain2/vm)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/vm)](https://packagephobia.now.sh/result?p=@gxchain2/vm)
![License](https://img.shields.io/npm/l/@gxchain2/vm)


Virtual machine based on `@ethereumjs/vm`, added logic about `run block` and `run call`

## INSTALL

```sh
npm install @gxchain2/vm
```

## USAGE

```ts
wrappedvm = new WrappedVM(
      new VM({
        common: stateManager._common,
        stateManager,
        blockchain: blockchain
      })
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
