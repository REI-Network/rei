# @gxchain2/tx-pool
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/tx-pool)](https://www.npmjs.org/package/@gxchain2/tx-pool)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/tx-pool)](https://packagephobia.now.sh/result?p=@gxchain2/tx-pool)
![License](https://img.shields.io/npm/l/@gxchain2/tx-pool)


Tx-pool has functions can be summarized as: transaction caching, transaction verification and transaction filtering.
It has event `readies` for transaction from queue into pending.

## INSTALL

```sh
npm install @gxchain2/tx-pool
```

## USAGE

```ts
txPool = new TxPool(
{ 
    node: node, 
    journal: "path/to/jornal"
});

txPool.newBlock(block); //new block with block message

txPool.addTxs(transaction); // add a transaction into pool

txPool.getPooledTransactionHashes(); // get transactions in pool
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
