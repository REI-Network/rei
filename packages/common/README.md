# @rei-network/common

[![NPM Version](https://img.shields.io/npm/v/@rei-network/common)](https://www.npmjs.org/package/@rei-network/common)
![License](https://img.shields.io/npm/l/@rei-network/common)

The basic settings of rei, based on `@ethereumjs/common`, including parameters of the mainnet and testnet:

- `chains` Chain information of each chain
- `genesisStates` Initial state of each chain
- `RIP`(REI-Network Improvement Proposal) of each chain
- `hardforks` Fork information of each chain

## INSTALL

```sh
npm install @rei-network/common
```

## USAGE

```ts
// create chain start common with chain name
Common.createChainStartCommon("rei-mainnet");
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
