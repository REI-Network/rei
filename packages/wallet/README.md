# @gxchain2/wallet

[![NPM Version](https://img.shields.io/npm/v/@gxchain2/wallet)](https://www.npmjs.org/package/@gxchain2/wallet)
![License](https://img.shields.io/npm/l/@gxchain2/wallet)

Wallet based on `ethereumjs-wallet`, for managing local accounts

## INSTALL

```sh
npm install @gxchain2/wallet
```

## USAGE

```ts
const manager = new AccountManager('/root/.gxchain2/keystore');

// new account
const { address } = await manager.newAccount('passphrase');
console.log('new address:', address);

// unlock account
await manager.unlock(address, 'passphrase');

// get account private key
console.log(manager.getPrivateKey(address).toString('hex'));
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
