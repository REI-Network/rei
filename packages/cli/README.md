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
  --rpc-api <apis>                           rpc server apis: debug, eth, net, txpool, web3, rei
  --p2p-tcp-port <port>                      p2p server tcp port
  --p2p-udp-port <port>                      p2p server udp port
  --p2p-nat <ip>                             p2p server nat ip
  --max-peers <peers>                        max p2p peers count
  --max-dials <dials>                        max p2p dials count
  --bootnodes <bootnodes...>                 comma separated list of bootnodes
  --sync <sync>                              sync mode: full, snap (default: "full")
  --snap-trusted-height <trustedHeight>      snap sync trusted height.
                                             this value and trustedHash are specified at the same time to take effect.
                                             snap sync will start from the specified block to verify the legitimacy.
                                             e.g. 100
  --snap-trusted-hash <trustedHash>          snap sync trusted hash.
                                             this value and trustedHeight are specified at the same time to take effect.
                                             snap sync will start from the specified block to verify the legitimacy.
                                             e.g. 0x123...
  --snap-min-td <minTD>                      minimum total difficulty difference for snap sync
  --skip-verify-snap                         whether skip verifing snapshot
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
  --bls <bls>                                the datadir for bls (default: "bls")
  --bls-password <blsPassword>               bls password file to use for non-interactive password input
  --bls-file <blsFile>                       bls file name
  -h, --help                                 display help for command

Commands:
  account                                    Manage accounts
  attach [ipcpath]                           Start an interactive JavaScript environment (connect to node)
  console                                    Start an interactive JavaScript environment
  bls                                        Manage bls signature key
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
