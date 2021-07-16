# @gxchain2/database

[![NPM Version](https://img.shields.io/npm/v/@gxchain2/database)](https://www.npmjs.org/package/@gxchain2/database)
![License](https://img.shields.io/npm/l/@gxchain2/database)

The low level database implementation, based on `@ehtereumjs/blockchain`. Added logic about `Receipt`, `Transaction` and `BloomBits`.

## INSTALL

```sh
npm install @gxchain2/database
```

## USAGE

```ts
const db = new Database(levelDB, common);
console.log((await db.getTransaction(txHash)).toJSON());
console.log((await db.getReceipt(txHash)).toRPCJson());
console.log((await db.getBloomBits(bit, section, hash)).toString('hex'));
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
