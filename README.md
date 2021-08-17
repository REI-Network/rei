# GXChain2.0-Alpha

![Node Version](https://img.shields.io/badge/node-%e2%89%a5v14.0.0-blue)
![NPM Version](https://img.shields.io/badge/npm-%E2%89%A5v6.0.0-blue)

Nodejs implementation of GXChain2.0 protocols

> This project is under continuous development, all protocols and modules may be changed in the future, use it at your own risk

| package                                    | npm                                                          | issues                                                           |
| ------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| [@gxchain2/structure][structure-package]   | [![NPM Version][structure-npm-version]][structure-npm-url]   | [![Block Issues][structure-issues]][structure-issues-url]        |
| [@gxchain2/blockchain][blockchain-package] | [![NPM Version][blockchain-npm-version]][blockchain-npm-url] | [![Blockchain Issues][blockchain-issues]][blockchain-issues-url] |
| [@gxchain2/cli][cli-package]               | [![NPM Version][cli-npm-version]][cli-npm-url]               | [![Cli Issues][cli-issues]][cli-issues-url]                      |
| [@gxchain2/contracts][contracts-package]   | [![NPM Version][contracts-npm-version]][contracts-npm-url]   | [![Contracts Issues][contracts-issues]][contracts-issues-url]    |
| [@gxchain2/utils][utils-package]           | [![NPM Version][utils-npm-version]][utils-npm-url]           | [![Utils Issues][utils-issues]][utils-issues-url]                |
| [@gxchain2/core][core-package]             | [![NPM Version][core-npm-version]][core-npm-url]             | [![Core Issues][core-issues]][core-issues-url]                   |
| [@gxchain2/common][common-package]         | [![NPM Version][common-npm-version]][common-npm-url]         | [![Common Issues][common-issues]][common-issues-url]             |
| [@gxchain2/database][database-package]     | [![NPM Version][database-npm-version]][database-npm-url]     | [![Database Issues][database-issues]][database-issues-url]       |
| [@gxchain2/network][network-package]       | [![NPM Version][network-npm-version]][network-npm-url]       | [![Network Issues][network-issues]][network-issues-url]          |
| [@gxchain2/rpc][rpc-package]               | [![NPM Version][rpc-npm-version]][rpc-npm-url]               | [![Rpc Issues][rpc-issues]][rpc-issues-url]                      |
| [@gxchain2/wallet][wallet-package]         | [![NPM Version][wallet-npm-version]][wallet-npm-url]         | [![Wallet Issues][wallet-issues]][wallet-issues-url]             |

## Quick start

### Install

```
npm install @gxchain2/cli --global
```

### Usage

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

### Example

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

### `npm run build:core`, `npm run build:contracts`, `...`

Only build single monorepo package.

### `npm run clean`

Removes root and packages `node_modules`, `dist` directories, and other generated files.

### `npm run clean:build`

Only remove `dist` directories for each monorepo packages.

### `npm run lint`, `npm run lint:fix`

These scripts execute lint and lint:fix respectively, to all monorepo packages.

## FAQ

- Q: Why do I get `EACCES: permission denied` or `node-gyp: Permission denied` when I install `@gxchain2/cli`?

  <details><summary> like this </summary>

  ```
  > bigint-buffer@1.1.5 install /xxx/v14.16.1/lib/node_modules/@gxchain2/cli/node_modules/bigint-buffer
  > npm run rebuild || echo "Couldn't build bindings. Non-native version used."

  Error: EACCES: permission denied, scandir '/xxx/v14.16.1/lib/node_modules/@gxchain2/cli/node_modules/bigint-buffer'

  > bcrypto@5.4.0 install /xxx/v14.16.1/lib/node_modules/@gxchain2/cli/node_modules/bcrypto
  > node-gyp rebuild

  sh: 1: node-gyp: Permission denied
  npm ERR! code ELIFECYCLE
  npm ERR! syscall spawn
  npm ERR! file sh
  npm ERR! errno ENOENT
  npm ERR! bcrypto@5.4.0 install: `node-gyp rebuild`
  npm ERR! spawn ENOENT
  npm ERR!
  npm ERR! Failed at the bcrypto@5.4.0 install script.
  npm ERR! This is probably not a problem with npm. There is likely additional logging output above.

  npm ERR! A complete log of this run can be found in:
  npm ERR!     /xxx/.npm/_logs/2021-07-14T02_24_45_172Z-debug.log
  ```

  </details>

  A: Please run

  ```
  npm install @gxchain2/cli -g --unsafe-perm=true --allow-root
  ```

- Q: Why do I get `SyntaxError: Unexpected token '?'` when I run `gxchain2`?

  <details><summary> like this </summary>

  ```
  /xxx/v12.20.0/lib/node_modules/@gxchain2/cli/node_modules/@gxchain2/discv5/lib/service/addrVotes.js:44
          let best = [tiebreakerStr, this.tallies[tiebreakerStr] ?? 0];
                                                                  ^

  SyntaxError: Unexpected token '?'
      at wrapSafe (internal/modules/cjs/loader.js:915:16)
      at Module._compile (internal/modules/cjs/loader.js:963:27)
      at Object.Module._extensions..js (internal/modules/cjs/loader.js:1027:10)
      at Module.load (internal/modules/cjs/loader.js:863:32)
      at Function.Module._load (internal/modules/cjs/loader.js:708:14)
      at Module.require (internal/modules/cjs/loader.js:887:19)
      at require (internal/modules/cjs/helpers.js:74:18)
      at Object.<anonymous> (/xxx/v12.20.0/lib/node_modules/@gxchain2/cli/node_modules/@gxchain2/discv5/lib/service/service.js:18:21)
      at Module._compile (internal/modules/cjs/loader.js:999:30)
      at Object.Module._extensions..js (internal/modules/cjs/loader.js:1027:10)
  ```

  </details>

  A: Please update the node version to **14.0.0** or higher. [nvm](https://github.com/nvm-sh/nvm) may be able to help you

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)

[structure-package]: ./packages/structure
[structure-npm-version]: https://img.shields.io/npm/v/@gxchain2/structure
[structure-npm-url]: https://www.npmjs.org/package/@gxchain2/structure
[structure-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20structure?label=issues
[structure-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+structure"
[blockchain-package]: ./packages/blockchain
[blockchain-npm-version]: https://img.shields.io/npm/v/@gxchain2/blockchain
[blockchain-npm-url]: https://www.npmjs.org/package/@gxchain2/blockchain
[blockchain-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20blockchain?label=issues
[blockchain-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+blockchain"
[cli-package]: ./packages/cli
[cli-npm-version]: https://img.shields.io/npm/v/@gxchain2/cli
[cli-npm-url]: https://www.npmjs.org/package/@gxchain2/cli
[cli-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20cli?label=issues
[cli-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+cli"
[contracts-package]: ./packages/contracts
[contracts-npm-version]: https://img.shields.io/npm/v/@gxchain2/contracts
[contracts-npm-url]: https://www.npmjs.org/package/@gxchain2/contracts
[contracts-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20contracts?label=issues
[contracts-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+contracts"
[utils-package]: ./packages/utils
[utils-npm-version]: https://img.shields.io/npm/v/@gxchain2/utils
[utils-npm-url]: https://www.npmjs.org/package/@gxchain2/utils
[utils-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20utils?label=issues
[utils-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+utils"
[core-package]: ./packages/core
[core-npm-version]: https://img.shields.io/npm/v/@gxchain2/core
[core-npm-url]: https://www.npmjs.org/package/@gxchain2/core
[core-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20core?label=issues
[core-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+core"
[common-package]: ./packages/common
[common-npm-version]: https://img.shields.io/npm/v/@gxchain2/common
[common-npm-url]: https://www.npmjs.org/package/@gxchain2/common
[common-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20common?label=issues
[common-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+common"
[database-package]: ./packages/database
[database-npm-version]: https://img.shields.io/npm/v/@gxchain2/database
[database-npm-url]: https://www.npmjs.org/package/@gxchain2/database
[database-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20database?label=issues
[database-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+database"
[network-package]: ./packages/network
[network-npm-version]: https://img.shields.io/npm/v/@gxchain2/network
[network-npm-url]: https://www.npmjs.org/package/@gxchain2/network
[network-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20network?label=issues
[network-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+network"
[rpc-package]: ./packages/rpc
[rpc-npm-version]: https://img.shields.io/npm/v/@gxchain2/rpc
[rpc-npm-url]: https://www.npmjs.org/package/@gxchain2/rpc
[rpc-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20rpc?label=issues
[rpc-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+rpc"
[wallet-package]: ./packages/wallet
[wallet-npm-version]: https://img.shields.io/npm/v/@gxchain2/wallet
[wallet-npm-url]: https://www.npmjs.org/package/@gxchain2/wallet
[wallet-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20wallet?label=issues
[wallet-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+wallet"
