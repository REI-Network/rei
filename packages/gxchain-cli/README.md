# GXChain2.0 CLI

[![NPM Version](https://img.shields.io/npm/v/@gxchain2/cli)](https://www.npmjs.org/package/@gxchain2/cli)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/cli)](https://packagephobia.now.sh/result?p=@gxchain2/cli)
![License](https://img.shields.io/npm/l/@gxchain2/cli)

Command Line of GXChain2.0

**This project is currently under development, so no default bootnodes is currently provided.**

## Install

```
npm i -g @gxchain2/cli
```

## Usage

```
Usage: index [options] [command]

Options:
  -V, --version               output the version number
  --rpc                       open rpc server
  --rpc-port <port>           rpc server port (default: "12358")
  --rpc-host <port>           rpc server host (default: "127.0.0.1")
  --p2p-tcp-port <port>       p2p server tcp port (default: "0")
  --p2p-ws-port <port>        p2p server websocket port (default: "0")
  --bootnodes <bootnodes...>  bootnodes list
  --datadir <path>            chain data dir path (default: "./gxchain2")
  --mine                      mine block
  --coinbase <address>        miner address
  --mine-interval <interval>  mine interval (default: "5000")
  --block-gas-limit <gas>     block gas limit (default: "0xbe5c8b")
  --verbosity <verbosity>     logging verbosity: silent, error, warn, info, debug, detail (default: info) (default: "info")
  -h, --help                  display help for command

Commands:
  start                       start gxchain2
  attach                      attach to gxchain2 node
  help [command]              display help for command
```

## Example

```
gxc2 start --rpc --rpc-host 0.0.0.0 --rpc-port 12345 --datadir ~/gxc2
```