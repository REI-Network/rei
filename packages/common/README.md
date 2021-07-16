# @gxchain2/common
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/common)](https://www.npmjs.org/package/@gxchain2/common)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/common)](https://packagephobia.now.sh/result?p=@gxchain2/common)
![License](https://img.shields.io/npm/l/@gxchain2/common)


The basic settings of gxchain2, based on '@ethereumjs/common' including parameters of the mainnet and testnet: 
- `genesisStates` Initial state of the chain
  
- GIP Gxchain2 Improvement Proposal
  
- `hardforks` Fork information of the chain

## INSTALL

```sh
npm install @gxchain2/common
```

## STRUCTURE
```ts
/**
 * Common class to access chain and hardfork parameters, based on 'EthereumCommon'
 */
export declare class Common extends EthereumCommon {
    /**
     * Static method to create a Common object based on 'EthereumCommon'
     * @param chain The name (`mainnet`) or id (`1`)  or a object of a standard chain used to base the custom
     * chain params on.
     * @returns Common objcet
     */
    static createChainStartCommon(chain: number | string | Object): Common;
    /**
     * Static method to create a Common object and sets a new hardfork based on the block number provided
     * @param num block number
     * @param chain The name (`mainnet`) or id (`1`)  or a object of a standard chain used to base the custom
     * chain params on.
     * @returns Common objcet
     */
    static createCommonByBlockNumber(num: BNLike, chain: number | string | Object): Common;
}
```
## USAGE

```ts

common = Common.createChainStartCommon(chain);
Common.createCommonByBlockNumber(0, 5);        // create with chianID
Common.createCommonByBlockNumber(0, "goerli"); // create with chian name
Common.createCommonByBlockNumber(0,           // create with object containing chain information
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
