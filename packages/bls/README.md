# @rei-network/wallet

[![NPM Version](https://img.shields.io/npm/v/@rei-network/bls)](https://www.npmjs.org/package/@rei-network/bls)
![License](https://img.shields.io/npm/l/@rei-network/bls)

Bls package for Rei Network managing bls signature

## INSTALL

```sh
npm install @rei-network/bls
```

## USAGE

```ts
const manager = new BlsManager("/root/.rei/bls");

// new bls secret key
const { publickey,path } = await manager.newSigner("passphrase");
console.log("new publickey:", publickey);
console.log("new path:", path);
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
