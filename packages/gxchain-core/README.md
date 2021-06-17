# @gxchain2/core
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/core)](https://www.npmjs.org/package/@gxchain2/core)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/core)](https://packagephobia.now.sh/result?p=@gxchain2/core)
![License](https://img.shields.io/npm/l/@gxchain2/core)


The core logic of blockchain node, including:
- `BlockchainMonitor` contains several events
  
   - logs: When a new transaction's log is generated, respond.
   - removedLogs: When the transaction rolled back, respond.
   - newHeads: Respond to the new blockHeads.
  
- `ChainIndexer` and `BloomBitsFilter` : Index of chain and Bloom filter to find blocks and transactions.
  
- `Miner` and `Woker` : Calculate and generate blocks.
  
- `Fetcher` : Sync blockes from other nodes in the network.
  
- `TxFetcher` : Sync transactions from other nodes in the network.
  
- `Tracer` : Trace blocks and transactions to debug the program.

## INSTALL

```sh
npm install @gxchain2/core
```

## USAGE

```ts
const node = new Node({
  databasePath:"path/to/database",
  chain: "gxc2-mainnet",
  mine:{
    coinbase:"0xd1e52f6eacbb95f5f8512ff129cbd6360e549b0b",
    gasLimit:"21000"
  }
  p2p:{
    bootnodes:[/ip4/127.0.0.1/tcp/41115/p2p/12D3KooWMWg2wU3fzqVR1bGcuVhSqNtPp8ugB3XAzfFtci7ywVgK]
  },
  account:{
    keyStorePath:"path/to/keystore",
    unlock:[["d1e52f6eacbb95f5f8512ff129cbd6360e549b0b",privatekey]]
  }
});
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
