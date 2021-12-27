# @rei-network/core

[![NPM Version](https://img.shields.io/npm/v/@rei-network/core)](https://www.npmjs.org/package/@rei-network/core)
![License](https://img.shields.io/npm/l/@rei-network/core)

The core logic of blockchain node, including:

- `BlockchainMonitor`: Contains several events

  - `logs`: Emit when a new transaction's log is generated
  - `removedLogs`: Emit when the transaction has been rolled back
  - `newHeads`: Emit when canonical chain changes

- `Indexer` and `BloomBitsFilter`: Create bloom bits index for section
- `Consensus`: Consensus engine implement
- `Protocols`: P2P protocols, include `rei-ethwire` and `rei-consensus`
- `Txpool`: Manage pending and queued transactions
- `Sync` : Synchronize blocks
- `TxSync`: Synchronize transactions
- `Tracer`: Tracer provides an implementation of tracing blocks or transactions
- `Contracts`: Some classes are used to interact with the smart contract
- `Validation`: Contains the logic to verify the block
- `Hardforks`: Contains logic related to the hard fork

## INSTALL

```sh
npm install @rei-network/core
```

## USAGE

```ts
const node = await NodeFactory.createNode({
  databasePath: "path/to/dataDir",
  chain: "chainName",
  mine: {
    enable: true,
    coinbase: "address1",
  },
  network: {
    enable: true,
  },
  account: {
    keyStorePath: "path/to/keystore",
    unlock: [
      ["address1", "passphrase1"],
      ["address2", "passphrase2"],
    ],
  },
});

await node.abort();
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
