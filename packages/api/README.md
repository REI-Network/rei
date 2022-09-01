# @rei-network/api

[![NPM Version](https://img.shields.io/npm/v/@rei-network/api)](https://www.npmjs.org/package/@rei-network/api)
![License](https://img.shields.io/npm/l/@rei-network/api)

Api call interface of websocket and http provides for ipc and rpc

Api has several controller
- `admin`: Admin api to control node link and rpc state
- `debug`: Debug api for tracing blocks and transactions, includes: `debug_traceBlock`, `debug_traceTransaction` ...etc

  **warning**: Debug api is very dangerous, public nodes shouldn't open

- `eth` ETH api for getting information from blockchain, includes: `eth_coinbase`, `eth_gasPrice` ...etc
- `net` ETH api for getting network state
- `rei` Rei api for getting crude state
- `txpool` Txpool api for getting information from txpool
- `web3` Web3 api

## INSTALL

```sh
npm install @rei-network/api
```

## USAGE

```ts
const server = new ApiServer(node);
await server.start();
await server.abort();
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
