# @gxchain2/blockchain
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/blockchain)](https://www.npmjs.org/package/@gxchain2/blockchain)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/blockchain)](https://packagephobia.now.sh/result?p=@gxchain2/blockchain)
![License](https://img.shields.io/npm/l/@gxchain2/blockchain)


 Definition of blockchain structure and rules, based on `@ethereumjs/blockchain`, fixed the incorrect calculation of total difficult difficulty under clique consensus,optimized the function to get the latest block `latestBlock`.

## INSTALL

```sh
npm install @gxchain2/blockchain
```

## USAGE
```ts
blockchain = new Blockchain({
  db: rawdb,
  database: db,
  common,
  genesisBlock
});
console.log(blockchain.latestBlock());
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)