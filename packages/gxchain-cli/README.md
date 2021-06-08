# GXChain2.0 CLI

[![NPM Version](https://img.shields.io/npm/v/@gxchain2/cli)](https://www.npmjs.org/package/@gxchain2/cli)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/cli)](https://packagephobia.now.sh/result?p=@gxchain2/cli)
![License](https://img.shields.io/npm/l/@gxchain2/cli)

Command Line of GXChain2.0

**This project is currently under development, so no default bootnodes is currently provided.**

## Install

```
npm install @gxchain2/cli --global
```

## Usage

```
Usage: index [options] [command]

Options:
  -V, --version               output the version number
  --rpc                       open rpc server
  --rpc-port <port>           rpc server port (default: "12358")
  --rpc-host <port>           rpc server host (default: "127.0.0.1")
  --rpc-api <apis>            rpc server apis: debug, eth, net, txpool, web3 (default: "eth,net,web3")
  --p2p-tcp-port <port>       p2p server tcp port (default: "0")
  --p2p-ws-port <port>        p2p server websocket port (default: "0")
  --bootnodes <bootnodes...>  bootnodes list
  --datadir <path>            chain data dir path (default: "/Users/samlior/.gxchain2")
  --chain <chain>             chain name: gxc2-mainnet, gxc2-testnet
  --mine                      mine block
  --coinbase <address>        miner address
  --verbosity <verbosity>     logging verbosity: silent, error, warn, info, debug, detail (default: "info")
  -h, --help                  display help for command

Commands:
  account                     Manage accounts
```

## Example

Block producer startup

```
gxc2 --rpc --rpc-host 0.0.0.0 --rpc-port 12345 --datadir ~/gxc2 --mine --coinbase 0x...abc
```

Normal node startup

```
gxc2 --rpc --rpc-host 0.0.0.0 --rpc-port 12345 --datadir ~/gxc2
```
