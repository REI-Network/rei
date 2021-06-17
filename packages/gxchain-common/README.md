# @gxchain2/common
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/common)](https://www.npmjs.org/package/@gxchain2/common)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/common)](https://packagephobia.now.sh/result?p=@gxchain2/common)
![License](https://img.shields.io/npm/l/@gxchain2/common)


The basic settings of gxchain2, based on '@ethereumjs/common' including parameters of the mainnet and testnet: 
- `Genesis states`  
- `GIP` Gxchain2 Improvement Proposal
- `Hardfork`

## INSTALL

```sh
npm install @gxchain2/common
```

## USAGE

```ts
//common生成三种情况，string number objcet
common = Common.createChainStartCommon(chain);
Common.createCommonByBlockNumber(0,5);
Common.createCommonByBlockNumber(0,"Goerli");
Common.createCommonByBlockNumber(0,
  {
    chain:"gxc2-mainnet",
    eips:[10001],
    hardfork:"byzantium",
    customChains:[]
  }
);
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
