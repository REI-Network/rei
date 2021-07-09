# @gxchain2/database
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/database)](https://www.npmjs.org/package/@gxchain2/database)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/database)](https://packagephobia.now.sh/result?p=@gxchain2/database)
![License](https://img.shields.io/npm/l/@gxchain2/database)


The low level database implementation, based on `@ehtereumjs/blockchain`. Added logic about `Receipt`, `BloomBits`.

## INSTALL

```sh
npm install @gxchain2/database
```
## STRUCTURE
```ts
/**
 * Database is based on Ethereum DBManager , storing/fetching
 * blockchain-related data,such as blocks and headers, indices,
 * and the head block
 */
export declare class Database extends DBManager {
    constructor(db: LevelUp, common: Common);
    get rawdb(): LevelUp;
    /**
     * Get the value in the database according to the given type and key
     * @param dbOperationTarget The type of data to be operated
     * @param key Used to generate database, identified by a block
     * hash, a block number, or both
     * @returns
     */
    get(dbOperationTarget: DBTarget, key?: DatabaseKey): Promise<any>;
    /**
     * Get transaction from database by transaction hash
     * @param txHash Transaction hash
     * @returns Transaction
     */
    getTransaction(txHash: Buffer): Promise<TypedTransaction>;
    /**
     * Get transaction from database by transaction hash, then
     * new a WrappedTransaction
     * @param txHash Transaction hash
     * @returns Wrapped Transaction
     */
    getWrappedTransaction(txHash: Buffer): Promise<WrappedTransaction>;
    /**
     * Get transaction receipt from database by transaction hash
     * @param txHash Transaction hash
     * @returns Transaction recript
     */
    getReceipt(txHash: Buffer): Promise<Receipt>;
    /**
     * Get transaction receipt from database by transaction hash,
     * blcokhash and blocknumber
     * @param txHash Transaction hash
     * @param blockHash Block hash
     * @param blockNumber Block number
     * @returns Transaction recript
     */
    getReceiptByHashAndNumber(txHash: Buffer, blockHash: Buffer, blockNumber: BN): Promise<Receipt>;
    /**
     * Get block from database by blockHash and blockNumber
     * @param blockHash  BlockHash
     * @param blockNumber BlockNumber
     * @returns Block
     */
    getBlockByHashAndNumber(blockHash: Buffer, blockNumber: BN): Promise<Block>;
    /**
     * Get BloomBits from database
     * @param bit Bit location
     * @param section Block section number
     * @param hash Header hash
     * @returns BloomBits
     */
    getBloomBits(bit: number, section: BN, hash: Buffer): Promise<any>;
    /**
     * Get Canonical block header
     * @param hash Block header hash
     * @returns Block header
     */
    tryToGetCanonicalHeader(hash: Buffer): Promise<BlockHeader | undefined>;
    getCanonicalHeader(num: BN): Promise<BlockHeader>;
    /**
     * Find the common ancestor block of two blocks
     * @param header1 The header of block1
     * @param header2 The header of block2
     * @returns Ancestor block header
     */
    findCommonAncestor(header1: BlockHeader, header2: BlockHeader): Promise<BlockHeader>;
    /**
     * Get section count of database
     * @returns Max section
     */
    getStoredSectionCount(): Promise<BN | undefined>;
    /**
     * Set section count of database
     * @param section
     */
    setStoredSectionCount(section: BN | undefined): Promise<void>;
}
```
## USAGE

```ts
const db = new Database(levelDB, common);
console.log((await db.getReceipt(txHash)).toRPCJson());
console.log((await db.getBloomBits(bit, section, hash)).toString('hex'));
```

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
