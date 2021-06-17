# @gxchain2/tx
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/tx)](https://www.npmjs.org/package/@gxchain2/tx)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/tx)](https://packagephobia.now.sh/result?p=@gxchain2/tx)
![License](https://img.shields.io/npm/l/@gxchain2/tx)


The definition of transaction structure based on `@ethereumjs/tx`, add class `WrappedTransaction`and logic about `toRPCJSON`.

## INSTALL

```sh
npm install @gxchain2/tx
```

## USAGE

```ts
const wtx = new WrappedTransaction(transaction);
console.log(wtx.toRPCJSON());
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
