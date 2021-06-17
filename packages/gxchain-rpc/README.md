# @gxchain2/rpc
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/rpc)](https://www.npmjs.org/package/@gxchain2/rpc)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/rpc)](https://packagephobia.now.sh/result?p=@gxchain2/rpc)
![License](https://img.shields.io/npm/l/@gxchain2/rpc)


Rpc call interface of websocket and http.
- `debug` Dangerous, public nodes should not be opened
- `eth` Basic call interface
- `net` Interface for network
- `txpool` Interface for transactions' pool
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
