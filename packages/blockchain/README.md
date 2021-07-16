# @gxchain2/blockchain

[![NPM Version](https://img.shields.io/npm/v/@gxchain2/blockchain)](https://www.npmjs.org/package/@gxchain2/blockchain)
![License](https://img.shields.io/npm/l/@gxchain2/blockchain)

Definition of blockchain structure and rules, based on `@ethereumjs/blockchain`

## INSTALL

```sh
npm install @gxchain2/blockchain
```

## USAGE

```ts
blockchain = new Blockchain({
  db: chaindb, // Database to store blocks and metadata. Should be an abstract-leveldown compliant store.
  database: database,
  genesisBlock // Messages of genesis block to initialize blockchain
});

await blockchain.putBlock(block);
console.log(blockchain.latestBlock);
console.log(blockchain.totalDifficulty);
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
