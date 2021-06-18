# @gxchain2/rpc
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/rpc)](https://www.npmjs.org/package/@gxchain2/rpc)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/rpc)](https://packagephobia.now.sh/result?p=@gxchain2/rpc)
![License](https://img.shields.io/npm/l/@gxchain2/rpc)


Rpc call interface of websocket and http.
- `DebugController`: Debug interface, for tracing blocks and transactions, for example: *debug_traceBlock*, *debug_traceTransaction* *...etc*.

  **warning**: this interface is dangerous, public nodes should not open

- `ETHController` Basic call interface, to get messages of blockchain, for example: *eth_coinbase*, *eth_gasPrice* *...etc*.

- `NetController` Interface to get network state, for example: *net_version*, *net_listenging* *...etc*.
  
- `txpool` Interface to get txpool state.
  
- `web3` Web3 compatible interface

## INSTALL

```sh
npm install @gxchain2/rpc
```

## USAGE

```sh
const server = new RpcServer(34456, "127.0.0.1", "eth,net,txpool,web3", node);
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
