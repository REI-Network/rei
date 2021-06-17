# @gxchain2/wallet
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/wallet)](https://www.npmjs.org/package/@gxchain2/wallet)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/wallet)](https://packagephobia.now.sh/result?p=@gxchain2/wallet)
![License](https://img.shields.io/npm/l/@gxchain2/wallet)


Wallet based on `ethereumjs-wallet`, for managing accounts.

## INSTALL

```sh
npm install @gxchain2/wallet
```

## USAGE

```ts
const manager = new AccountManager(getKeyStorePath(program.opts()));
manager.newAccount("passphrase");
manager.update("0xAE0c03FdeDB61021272922F7804505CEE2C12c78", "passphrase", "newPassphrase");
manager.hasAccount("0xAE0c03FdeDB61021272922F7804505CEE2C12c78");
manager.importKeyByPrivateKey("privateKey", "passphrase");
console.log(manager.totalAccounts());
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)