# @gxchain2/core

[![NPM Version](https://img.shields.io/npm/v/@gxchain2/core)](https://www.npmjs.org/package/@gxchain2/core)
![License](https://img.shields.io/npm/l/@gxchain2/core)

The core logic of blockchain node, including:

- `BlockchainMonitor`: Contains several events

  - `logs`: Emit when a new transaction's log is generated
  - `removedLogs`: Emit when the transaction has been rolled back
  - `newHeads`: Emit when canonical chain changes

- `Indexer` and `BloomBitsFilter`: Create bloom bits index for section
- `Miner`: Generate blocks
- `Protocols`: Used for communication and data transmission between nodes
- `Txpool`: Manage pending and queued transactions
- `Sync` : Synchronize blocks
- `Txsync`: Synchronize transactions
- `Tracer`: Tracer provides an implementation of tracing blocks or transactions

## INSTALL

```sh
npm install @gxchain2/core
```

## USAGE

```ts
const node = new Node({
  databasePath: '/root/.gxchain2',
  chain: 'gxc2-testnet',
  mine: {
    enable: false
  },
  p2p: {
    enable: false
  },
  account: {
    keyStorePath: '/root/.gxchain2/keystore'),
    unlock: []
  }
});

await node.init();
await node.abort();
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
