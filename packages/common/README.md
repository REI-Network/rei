# @gxchain2/common

[![NPM Version](https://img.shields.io/npm/v/@gxchain2/common)](https://www.npmjs.org/package/@gxchain2/common)
![License](https://img.shields.io/npm/l/@gxchain2/common)

The basic settings of gxchain2, based on `@gxchain2-ethereumjs/common`, including parameters of the mainnet and testnet:

- `chains` Chain information of each chain
- `genesisStates` Initial state of each chain
- `GIP`(GXChain2.0 Improvement Proposal) of each chain
- `hardforks` Fork information of each chain

## INSTALL

```sh
npm install @gxchain2/common
```

## USAGE

```ts
// create chain start common with chain name
Common.createChainStartCommon("gxc2-mainnet");
// create with chain id
Common.createCommonByBlockNumber(0, 12347);
// create with chain name
Common.createCommonByBlockNumber(0, "goerli");
// create with an object containing chain information
Common.createCommonByBlockNumber(0, {
  chain: "mychain",
  networkId: 100,
  genesis: {
    // ...genesis block
  },
  hardforks: [],
  bootstrapNodes: [],
});
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
