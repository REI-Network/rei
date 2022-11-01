# REI-Network CLI

[![NPM Version](https://img.shields.io/npm/v/@rei-network/cli)](https://www.npmjs.org/package/@rei-network/cli)
![License](https://img.shields.io/npm/l/@rei-network/cli)

Command Line of REI-Network

## Install

```
npm install @rei-network/cli --global
```

## Usage

```
Usage: rei [options] [command]

Options:
  -V, --version                              output the version number
  --rpc                                      open rpc server
  --rpc-port <port>                          rpc server port
  --rpc-host <port>                          rpc server host
  --rpc-api <apis>                           rpc server apis: debug, eth, net, txpool, web3
  --p2p-tcp-port <port>                      p2p server tcp port
  --p2p-udp-port <port>                      p2p server udp port
  --p2p-nat <ip>                             p2p server nat ip
  --max-peers <peers>                        max p2p peers count
  --max-dials <dials>                        max p2p dials count
  --bootnodes <bootnodes...>                 comma separated list of bootnodes
  --datadir <path>                           chain data dir path (default: "~/.rei")
  --keystore <keystore>                      the datadir for keystore (default: "keystore")
  --unlock <unlock>                          comma separated list of accounts to unlock
  --password <password>                      password file to use for non-interactive password input
  --chain <chain>                            chain name: rei-mainnet, rei-testnet, rei-devnet
  --mine                                     mine block
  --coinbase <address>                       miner address
  --verbosity <verbosity>                    logging verbosity: silent, error, warn, info, debug, detail (default: "info")
  --receipts-cache-size <receiptsCacheSize>  receipts cache size
  --evm <evm>                                evm implementation type, "js" or "binding"
  -h, --help                                 display help for command

Commands:
  account                                    Manage accounts
  attach [ipcpath]                           Start an interactive JavaScript environment (connect to node)
  console                                    Start an interactive JavaScript environment
```

## Example

Block producer startup

```
rei --mine --coinbase 0x...abc --unlock 0x...abc --password ./password
```

Normal node startup

```
rei --rpc --rpc-host 0.0.0.0
```

Bootnode startup

```
rei --p2p-nat 1.2.3.4
```

Testnet node startup

```
rei --chain rei-testnet
```
