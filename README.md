# GXChain2.0

| package                                          | npm                                                                | issues                                                                    | 
| ------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| [@gxchain2/block][block-package]                 | [![NPM Version][block-npm-version]][block-npm-url]                 | [![Block Issues][block-issues]][block-issues-url]                         |
| [@gxchain2/blockchain][blockchain-package]       | [![NPM Version][blockchain-npm-version]][blockchain-npm-url]       | [![Blockchain Issues][blockchain-issues]][blockchain-issues-url]          |
| [@gxchain2/tx][tx-package]                       | [![NPM Version][tx-npm-version]][tx-npm-url]                       | [![Tx Issues][tx-issues]][tx-issues-url]                                  |
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

This monorepo uses Lerna. Please install lerna first.

```
npm i -g lerna
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

#### `npm run lint`, `npm run lint:fix`

These scripts execute lint and lint:fix respectively, to all monorepo packages.

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)

[block-package]: ./packages/block
[block-npm-version]: https://img.shields.io/npm/v/@gxchain2/block
[block-npm-url]: https://www.npmjs.org/package/@gxchain2/block
[block-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20block?label=issues
[block-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+block"
[blockchain-package]: ./packages/blockchain
[blockchain-npm-version]: https://img.shields.io/npm/v/@gxchain2/blockchain
[blockchain-npm-url]: https://www.npmjs.org/package/@gxchain2/blockchain
[blockchain-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20blockchain?label=issues
[blockchain-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+blockchain"
[tx-package]: ./packages/tx
[tx-npm-version]: https://img.shields.io/npm/v/@gxchain2/tx
[tx-npm-url]: https://www.npmjs.org/package/@gxchain2/tx
[tx-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20tx?label=issues
[tx-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+tx"
[tx-pool-package]: ./packages/tx-pool
[tx-pool-npm-version]: https://img.shields.io/npm/v/@gxchain2/tx-pool
[tx-pool-npm-url]: https://www.npmjs.org/package/@gxchain2/tx-pool
[tx-pool-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20tx-pool?label=issues
[tx-pool-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+tx-pool"
[receipt-package]: ./packages/receipt
[receipt-npm-version]: https://img.shields.io/npm/v/@gxchain2/receipt
[receipt-npm-url]: https://www.npmjs.org/package/@gxchain2/receipt
[receipt-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20receipt?label=issues
[receipt-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+receipt"
[vm-package]: ./packages/vm
[vm-npm-version]: https://img.shields.io/npm/v/@gxchain2/vm
[vm-npm-url]: https://www.npmjs.org/package/@gxchain2/vm
[vm-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20vm?label=issues
[vm-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+vm"
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
[crypto-package]: ./packages/crypto
[crypto-npm-version]: https://img.shields.io/npm/v/@gxchain2/crypto
[crypto-npm-url]: https://www.npmjs.org/package/@gxchain2/crypto
[crypto-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20crypto?label=issues
[crypto-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+crypto"
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
[state-manager-package]: ./packages/state-manager
[state-manager-npm-version]: https://img.shields.io/npm/v/@gxchain2/state-manager
[state-manager-npm-url]: https://www.npmjs.org/package/@gxchain2/state-manager
[state-manager-issues]: https://img.shields.io/github/issues/gxchain/gxchain2/package:%20state-manager?label=issues
[state-manager-issues-url]: https://github.com/gxchain/gxchain2/issues?q=is%3Aopen+is%3Aissue+label%3A"package%3A+state-manager"
