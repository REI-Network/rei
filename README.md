# GXChain2.0-Alpha

![Node Version](https://img.shields.io/badge/node-%e2%89%a5v14.0.0-blue)
![NPM Version](https://img.shields.io/badge/npm-%E2%89%A5v6.0.0-blue)

Nodejs implementation of GXChain2.0 protocols

> This project is under continuous development, all protocols and modules may be changed in the future, use it at your own risk

| package                                          | npm                                                                | issues                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| [@gxchain2/block][block-package]                 | [![NPM Version][block-npm-version]][block-npm-url]                 | [![Block Issues][block-issues]][block-issues-url]                         |
| [@gxchain2/blockchain][blockchain-package]       | [![NPM Version][blockchain-npm-version]][blockchain-npm-url]       | [![Blockchain Issues][blockchain-issues]][blockchain-issues-url]          |
| [@gxchain2/tx][tx-package]                       | [![NPM Version][tx-npm-version]][tx-npm-url]                       | [![Tx Issues][tx-issues]][tx-issues-url]                                  |
| [@gxchain2/cli][cli-package]                     | [![NPM Version][cli-npm-version]][cli-npm-url]                     | [![Cli Issues][cli-issues]][cli-issues-url]                               |
| [@gxchain2/tx-pool][tx-pool-package]             | [![NPM Version][tx-pool-npm-version]][tx-pool-npm-url]             | [![Tx-pool Issues][tx-pool-issues]][tx-pool-issues-url]                   |
| [@gxchain2/receipt][receipt-package]             | [![NPM Version][receipt-npm-version]][receipt-npm-url]             | [![Receipt Issues][receipt-issues]][receipt-issues-url]                   |
| [@gxchain2/vm][vm-package]                       | [![NPM Version][vm-npm-version]][vm-npm-url]                       | [![Vm Issues][vm-issues]][vm-issues-url]                                  |
| [@gxchain2/utils][utils-package]                 | [![NPM Version][utils-npm-version]][utils-npm-url]                 | [![Utils Issues][utils-issues]][utils-issues-url]                         |
| [@gxchain2/core][core-package]                   | [![NPM Version][core-npm-version]][core-npm-url]                   | [![Core Issues][core-issues]][core-issues-url]                            |
| [@gxchain2/common][common-package]               | [![NPM Version][common-npm-version]][common-npm-url]               | [![Common Issues][common-issues]][common-issues-url]                      |
| [@gxchain2/crypto][crypto-package]               | [![NPM Version][crypto-npm-version]][crypto-npm-url]               | [![Crypto Issues][crypto-issues]][crypto-issues-url]                      |
| [@gxchain2/database][database-package]           | [![NPM Version][database-npm-version]][database-npm-url]           | [![Database Issues][database-issues]][database-issues-url]                |
| [@gxchain2/network][network-package]             | [![NPM Version][network-npm-version]][network-npm-url]             | [![Network Issues][network-issues]][network-issues-url]                   |
| [@gxchain2/rpc][rpc-package]                     | [![NPM Version][rpc-npm-version]][rpc-npm-url]                     | [![Rpc Issues][rpc-issues]][rpc-issues-url]                               |
| [@gxchain2/state-manager][state-manager-package] | [![NPM Version][state-manager-npm-version]][state-manager-npm-url] | [![State-manager Issues][state-manager-issues]][state-manager-issues-url] |

## Quick start

### Install

```
npm install @gxchain2/cli --global
```

### Usage

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
  --datadir <path>            chain data dir path (default: "~/.gxchain2")
  --chain <chain>             chain name: gxc2-mainnet, gxc2-testnet
  --mine                      mine block
  --coinbase <address>        miner address
  --verbosity <verbosity>     logging verbosity: silent, error, warn, info, debug, detail (default: "info")
  -h, --help                  display help for command

Commands:
  account                     Manage accounts
```

### Example

Block producer startup

```
gxc2 --rpc --rpc-host 0.0.0.0 --rpc-port 12345 --datadir ~/gxc2 --mine --coinbase 0x...abc
```

Normal node startup

```
gxc2 --rpc --rpc-host 0.0.0.0 --rpc-port 12345 --datadir ~/gxc2
```

[More](./packages/gxchain-cli)

## Build

This monorepo uses Lerna. Please install lerna first.

```
npm install lerna --global
```

Setup and build

```
npm run bootstrap
```

## Project scripts — run from repository root

### `npm run bootstrap`

Installs dependencies for all sub-packages, and links them to create an integrated development environment.

### `npm run build`

Builds all monorepo packages.

### `npm run build:core`, `npm run build:vm`, `...`

Only build single monorepo package.

### `npm run clean`

Removes root and packages `node_modules`, `dist` directories, and other generated files.

### `npm run clean:build`

Only remove `dist` directories for each monorepo packages.

### `npm run lint`, `npm run lint:fix`

These scripts execute lint and lint:fix respectively, to all monorepo packages.

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)

[block-package]: ./packages/gxchain-block
[block-npm-version]: https://img.shields.io/npm/v/@gxchain2/block
[block-npm-url]: https://www.npmjs.org/package/@gxchain2/block
[block-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20block?label=issues
[block-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+block"
[blockchain-package]: ./packages/gxchain-blockchain
[blockchain-npm-version]: https://img.shields.io/npm/v/@gxchain2/blockchain
[blockchain-npm-url]: https://www.npmjs.org/package/@gxchain2/blockchain
[blockchain-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20blockchain?label=issues
[blockchain-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+blockchain"
[tx-package]: ./packages/gxchain-tx
[tx-npm-version]: https://img.shields.io/npm/v/@gxchain2/tx
[tx-npm-url]: https://www.npmjs.org/package/@gxchain2/tx
[tx-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20tx?label=issues
[tx-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+tx"
[cli-package]: ./packages/gxchain-cli
[cli-npm-version]: https://img.shields.io/npm/v/@gxchain2/cli
[cli-npm-url]: https://www.npmjs.org/package/@gxchain2/cli
[cli-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20cli?label=issues
[cli-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+cli"
[tx-pool-package]: ./packages/gxchain-tx-pool
[tx-pool-npm-version]: https://img.shields.io/npm/v/@gxchain2/tx-pool
[tx-pool-npm-url]: https://www.npmjs.org/package/@gxchain2/tx-pool
[tx-pool-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20tx-pool?label=issues
[tx-pool-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+tx-pool"
[receipt-package]: ./packages/gxchain-receipt
[receipt-npm-version]: https://img.shields.io/npm/v/@gxchain2/receipt
[receipt-npm-url]: https://www.npmjs.org/package/@gxchain2/receipt
[receipt-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20receipt?label=issues
[receipt-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+receipt"
[vm-package]: ./packages/gxchain-vm
[vm-npm-version]: https://img.shields.io/npm/v/@gxchain2/vm
[vm-npm-url]: https://www.npmjs.org/package/@gxchain2/vm
[vm-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20vm?label=issues
[vm-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+vm"
[utils-package]: ./packages/gxchain-utils
[utils-npm-version]: https://img.shields.io/npm/v/@gxchain2/utils
[utils-npm-url]: https://www.npmjs.org/package/@gxchain2/utils
[utils-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20utils?label=issues
[utils-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+utils"
[core-package]: ./packages/gxchain-core
[core-npm-version]: https://img.shields.io/npm/v/@gxchain2/core
[core-npm-url]: https://www.npmjs.org/package/@gxchain2/core
[core-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20core?label=issues
[core-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+core"
[common-package]: ./packages/gxchain-common
[common-npm-version]: https://img.shields.io/npm/v/@gxchain2/common
[common-npm-url]: https://www.npmjs.org/package/@gxchain2/common
[common-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20common?label=issues
[common-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+common"
[crypto-package]: ./packages/gxchain-crypto
[crypto-npm-version]: https://img.shields.io/npm/v/@gxchain2/crypto
[crypto-npm-url]: https://www.npmjs.org/package/@gxchain2/crypto
[crypto-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20crypto?label=issues
[crypto-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+crypto"
[database-package]: ./packages/gxchain-database
[database-npm-version]: https://img.shields.io/npm/v/@gxchain2/database
[database-npm-url]: https://www.npmjs.org/package/@gxchain2/database
[database-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20database?label=issues
[database-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+database"
[network-package]: ./packages/gxchain-network
[network-npm-version]: https://img.shields.io/npm/v/@gxchain2/network
[network-npm-url]: https://www.npmjs.org/package/@gxchain2/network
[network-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20network?label=issues
[network-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+network"
[rpc-package]: ./packages/gxchain-rpc
[rpc-npm-version]: https://img.shields.io/npm/v/@gxchain2/rpc
[rpc-npm-url]: https://www.npmjs.org/package/@gxchain2/rpc
[rpc-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20rpc?label=issues
[rpc-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+rpc"
[state-manager-package]: ./packages/gxchain-state-manager
[state-manager-npm-version]: https://img.shields.io/npm/v/@gxchain2/state-manager
[state-manager-npm-url]: https://www.npmjs.org/package/@gxchain2/state-manager
[state-manager-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20state-manager?label=issues
[state-manager-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+state-manager"
