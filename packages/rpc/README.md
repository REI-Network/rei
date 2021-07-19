# @gxchain2/rpc

[![NPM Version](https://img.shields.io/npm/v/@gxchain2/rpc)](https://www.npmjs.org/package/@gxchain2/rpc)
![License](https://img.shields.io/npm/l/@gxchain2/rpc)

Rpc call interface of websocket and http.

- `debug`: Debug api for tracing blocks and transactions, includes: `debug_traceBlock`, `debug_traceTransaction` ...etc

  **warning**: Debug api is very dangerous, public nodes shouldn't open

- `eth` ETH api for getting information from blockchain, includes: `eth_coinbase`, `eth_gasPrice` ...etc
- `net` ETH api for getting network state
- `txpool` Txpool api for getting information from txpool
- `web3` Web3 api

## INSTALL

```sh
npm install @gxchain2/rpc
```

## USAGE

```ts
const server = new RpcServer(34456, '127.0.0.1', 'eth,net,txpool,web3', node);
await server.start();
await server.abort();
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
