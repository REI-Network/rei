# @rei-network/database

[![NPM Version](https://img.shields.io/npm/v/@rei-network/database)](https://www.npmjs.org/package/@rei-network/database)
![License](https://img.shields.io/npm/l/@rei-network/database)

The low level database implementation, based on `@ehtereumjs/blockchain`. Added logic about `Receipt`, `Transaction` and `BloomBits`.

## INSTALL

```sh
npm install @rei-network/database
```

## USAGE

```ts
const db = new Database(levelDB, common);
console.log((await db.getTransaction(txHash)).toJSON());
console.log((await db.getReceipt(txHash)).toRPCJson());
console.log((await db.getBloomBits(bit, section, hash)).toString("hex"));
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
