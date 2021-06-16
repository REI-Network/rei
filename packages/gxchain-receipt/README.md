# @gxchain2/receipt
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/receipt)](https://www.npmjs.org/package/@gxchain2/receipt)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/receipt)](https://packagephobia.now.sh/result?p=@gxchain2/receipt)
![License](https://img.shields.io/npm/l/@gxchain2/receipt)


Transaction Receipts record the transaction outcome, and logs record the more details.
## INSTALL

```sh
npm install @gxchain2/receipt
```

## USAGE

```ts
const txReceipt = new Receipt(gasUsed, txRes.bloom.bitvector, txRes.execResult, txRes.execResult.exceptionError ? 0 : 1);
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
