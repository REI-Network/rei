# @gxchain2/rpc
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/rpc)](https://www.npmjs.org/package/@gxchain2/rpc)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/rpc)](https://packagephobia.now.sh/result?p=@gxchain2/rpc)
![License](https://img.shields.io/npm/l/@gxchain2/rpc)


Rpc call interface of wss and http.
## INSTALL

```sh
npm install @gxchain2/rpc
```

## USAGE

```sh
curl -X POST \
  http://localhost:12358 \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_getUncleByBlockHashAndIndex",
    "params":["0x00000000000000000000000000000000"],
    "id": 1
 }' | json_pp

```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
