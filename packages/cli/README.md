# GXChain2.0 CLI

[![NPM Version](https://img.shields.io/npm/v/@gxchain2/cli)](https://www.npmjs.org/package/@gxchain2/cli)
![License](https://img.shields.io/npm/l/@gxchain2/cli)

Command Line of GXChain2.0

**This project is currently under development, only testnet provides bootnode.**

## Install

```
npm install @gxchain2/cli --global
```

## Usage

```
Usage: gxchain2 [options] [command]

Options:
  -V, --version                    output the version number
  --rpc                            open rpc server
  --rpc-port <port>                rpc server port
  --rpc-host <port>                rpc server host
  --rpc-api <apis>                 rpc server apis: debug, eth, net, txpool, web3
  --p2p-tcp-port <port>            p2p server tcp port
  --p2p-udp-port <port>            p2p server udp port
  --p2p-nat <ip>                   p2p server nat ip
  --max-peers <peers>              max p2p peers count
  --max-connections <connections>  max p2p connections count
  --max-dials <dials>              max p2p dials count
  --bootnodes <bootnodes...>       comma separated list of bootnodes
  --datadir <path>                 chain data dir path (default: "~/.gxchain2")
  --keystore <keystore>            the datadir for keystore (default: "keystore")
  --unlock <unlock>                comma separated list of accounts to unlock
  --password <password>            password file to use for non-interactive password input
  --chain <chain>                  chain name: gxc2-mainnet, gxc2-testnet
  --mine                           mine block
  --coinbase <address>             miner address
  --verbosity <verbosity>          logging verbosity: silent, error, warn, info, debug, detail (default: "info")
  -h, --help                       display help for command

Commands:
  account                          Manage accounts
```

## Example

Block producer startup

```
gxchain2 --mine --coinbase 0x...abc --unlock 0x...abc --password ./password
```

Normal node startup

```
gxchain2 --rpc --rpc-host 0.0.0.0
```

Bootnode startup

```
gxchain2 --p2p-nat 1.2.3.4
```

Testnet node startup

```
gxchain2 --chain gxc2-testnet
```
