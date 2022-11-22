# @rei-network/rpc

[![NPM Version](https://img.shields.io/npm/v/@rei-network/rpc)](https://www.npmjs.org/package/@rei-network/rpc)
![License](https://img.shields.io/npm/l/@rei-network/rpc)

Rpc call interface of websocket and http.

- `admin`: Admin api for managing node
- `debug`: Debug api for tracing blocks and transactions, includes: `debug_traceBlock`, `debug_traceTransaction` ...etc

  **warning**: Debug api is very dangerous, public nodes shouldn't open

- `eth` ETH api for getting information from blockchain, includes: `eth_coinbase`, `eth_gasPrice` ...etc
- `net` ETH api for getting network state
- `txpool` Txpool api for getting information from txpool
- `web3` Web3 api

## INSTALL

```sh
npm install @rei-network/rpc
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
