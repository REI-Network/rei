# @gxchain2/core
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/core)](https://www.npmjs.org/package/@gxchain2/core)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/core)](https://packagephobia.now.sh/result?p=@gxchain2/core)
![License](https://img.shields.io/npm/l/@gxchain2/core)


The core logic of blockchain node, including blockchain monitor, bloombit and index,  mine blockes, sync blockes, sync transactions and trancer. 

## INSTALL

```sh
npm install @gxchain2/core
```

## USAGE

```ts
const node = new Node({
    databasePath: opts.datadir,
    chain: opts.chain,
    mine,
    p2p,
    account
  });
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
