# @gxchain2/blockchain
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/blockchain)](https://www.npmjs.org/package/@gxchain2/blockchain)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/blockchain)](https://packagephobia.now.sh/result?p=@gxchain2/blockchain)
![License](https://img.shields.io/npm/l/@gxchain2/blockchain)


 Definition of blockchain structure and rules, based on `@ethereumjs/blockchain`, fixed the incorrect calculation of total difficult difficulty under clique consensus,optimized the function to get the latest block `latestBlock`.

## INSTALL

```sh
npm install @gxchain2/blockchain
```

## STRUCTURE
```ts
/**
 * Blockchain represents the canonical chain given a database with a genesis
 * block. The Blockchain manages chain imports, reverts, chain reorganisations.
 */
export declare class Blockchain extends EthereumBlockchain {
    dbManager: Database;
    private _latestBlock;
    private _totalDifficulty;
    constructor(opts: BlockchainOptions);
    /**
     * Return blockchain's latest block
     */
    get latestBlock(): Block;
    /**
     * Return blockchain's latest block's number, if not exsit, return 0
     */
    get latestHeight(): number;
    /**
     * Return blockchain's latest block's hash, if not exsit, return '00'
     */
    get latestHash(): string;
    /**
     * Return blockchain's totalDifficulty
     */
    get totalDifficulty(): BN;
    /**
     * This method check and update the latestBlock, totalDifficulty of blockchain, issue the 'update' event
     */
    private updateLatest;
    /**
     * Initialize
     */
    init(): Promise<void>;
    /**
     * Adds a block to the blockchain by calling the method 'putBlock' of parent class
     * Update the blockchain's latest status
     *
     * @param block - The block to be added to the blockchain
     */
    putBlock(block: Block): Promise<void>;
    /**
     * Get active clique signers in a certain blocknumber, return addresses
     * @param number - The number of block
     * @returns Active clique signers
     */
    cliqueActiveSignersByBlockNumber(number: BN): Address[];
}
```

## USAGE
```ts
blockchain = new Blockchain({
  db: rawdb,    
  database: db, //Database to store blocks and metadata. Should be an abstract-leveldown compliant store.
  genesisBlock  //Messages of genesis block to initialize blockchain
});

console.log(blockchain.latestBlock);    
console.log(blockchain.totalDifficulty);
console.log(blockchain.latestHash);
console.log(blockchain.latestHeight);
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)