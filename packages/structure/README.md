# @gxchain2/structure
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/structure)](https://www.npmjs.org/package/@gxchain2/structure)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/structure)](https://packagephobia.now.sh/result?p=@gxchain2/structure)
![License](https://img.shields.io/npm/l/@gxchain2/structure)


Structure contains the definition of some structures on the chain, like `Block`, `Log`, `Receipt` and `Transaction`

- `Block` 

## INSTALL

```sh
npm install @gxchain2/structure
```

## STRUCTURE
- `Block`
```ts
/**
 * WrappedBlock based on Ethereum block.
 */
export declare class WrappedBlock {
    readonly block: Block;
    private readonly isPending;
    private _size?;
    constructor(block: Block, isPending?: boolean);
    /**
     * Get the size of the total block
     */
    get size(): number;
    /**
     * Convert the block into json form so that can be transported by rpc port
     * @param fullTransactions Whether to load all transaction information
     * @returns Converted Json object
     */
    toRPCJSON(fullTransactions?: boolean): {
        number: string | null;
        hash: string | null;
        parentHash: string;
        nonce: string | null;
        sha3Uncles: string;
        logsBloom: string | null;
        transactionsRoot: string;
        stateRoot: string;
        receiptsRoot: string;
        miner: string;
        mixHash: string;
        difficulty: string;
        totalDifficulty: string;
        extraData: string;
        size: string;
        gasLimit: string;
        gasUsed: string;
        timestamp: string;
        transactions: {
            blockHash: string | null;
            blockNumber: string | null;
            from: string;
            gas: string;
            gasPrice: string;
            hash: string;
            input: string;
            nonce: string;
            to: string | null;
            transactionIndex: string | null;
            value: string;
            v: string | undefined;
            r: string | undefined;
            s: string | undefined;
        }[] | string[];
        uncles: string[];
    };
}
```
- Log
```ts
/**
 * The transaction log records the details of the transaction
 */
export declare class Log {
    address: Buffer;
    topics: Buffer[];
    data: Buffer;
    blockHash?: Buffer;
    blockNumber?: BN;
    logIndex?: number;
    removed?: boolean;
    transactionHash?: Buffer;
    transactionIndex?: number;
    constructor(address: Buffer, topics: Buffer[], data: Buffer);
    /**
     * Generate Log object by given serialized data
     * @param serialized Serialized data
     * @returns A new Log object
     */
    static fromRlpSerializedLog(serialized: Buffer): Log;
    /**
     * Generate Log object by given values
     * @param values Given values
     * @returns A new Log object
     */
    static fromValuesArray(values: LogRawValues): Log;
    /**
     * Get the row data in the log information
     * @returns The object of address topics and data
     */
    raw(): LogRawValues;
    /**
     * Serialize transaction log information
     * @returns Encoded data
     */
    serialize(): Buffer;
    /**
     * Assign values to other members based on transaction receipt
     * @param receipt Transaction receip
     * @param logIndex Index of log
     */
    installProperties(receipt: Receipt, logIndex: number): void;
    /**
     * Convert the log into json form so that can be transported by rpc port
     * @returns Converted Json object
     */
    toRPCJSON(): {
        address: string;
        blockHash: string | undefined;
        blockNumber: string | undefined;
        data: string;
        logIndex: string | undefined;
        removed: boolean | undefined;
        topics: string[];
        transactionHash: string | undefined;
        transactionIndex: string | undefined;
    };
}
```

- `Receipt`
```ts
/**
 * Receipt represents the results of a transaction.
 */
export declare class Receipt {
    cumulativeGasUsed: Buffer;
    bitvector: Buffer;
    logs: Log[];
    status: 0 | 1;
    gasUsed?: BN;
    blockHash?: Buffer;
    blockNumber?: BN;
    contractAddress?: Buffer;
    from?: Buffer;
    to?: Buffer;
    transactionHash?: Buffer;
    transactionIndex?: number;
    /**
     * Return the cumulative gas used of type bn
     */
    get bnCumulativeGasUsed(): BN;
    constructor(cumulativeGasUsed: Buffer, bitvector: Buffer, logs: Log[], status: 0 | 1);
    /**
     * Generate receipt object by given serialized data
     * @param serialized Serialized data
     * @returns A receipt object
     */
    static fromRlpSerializedReceipt(serialized: Buffer): Receipt;
    /**
     * Generate receipt object by given values
     * @param values Given values
     * @returns A new receipt object
     */
    static fromValuesArray(values: ReceiptRawValue): Receipt;
    /**
     * Get the row data from receipt
     * @returns
     */
    raw(): ReceiptRawValue;
    /**
     * Serialize data
     * @returns Encoded data
     */
    serialize(): Buffer;
    /**
     * Assemble receipt according to the given value
     * @param block block
     * @param tx Transaction
     * @param gasUsed Gas used
     * @param txIndex Transaction index
     */
    installProperties(block: Block, tx: TypedTransaction, gasUsed: BN, txIndex: number): void;
    /**
     * Convert the receipt into json form so that can be transported by rpc port
     * @returns Converted Json object
     */
    toRPCJSON(): {
        blockHash: string | undefined;
        blockNumber: string | undefined;
        contractAddress: string | null;
        cumulativeGasUsed: string;
        from: string | undefined;
        gasUsed: string | undefined;
        logs: {
            address: string;
            blockHash: string | undefined;
            blockNumber: string | undefined;
            data: string;
            logIndex: string | undefined;
            removed: boolean | undefined;
            topics: string[];
            transactionHash: string | undefined;
            transactionIndex: string | undefined;
        }[];
        logsBloom: string;
        status: string;
        to: string | undefined;
        transactionHash: string | undefined;
        transactionIndex: string | undefined;
    };
}
```
- `Transaction`
```ts
/**
 * WrappedBlock based Ethereum transaction.
 */
export declare class WrappedTransaction {
    readonly transaction: TypedTransaction;
    constructor(transaction: TypedTransaction);
    extension: {
        blockHash?: Buffer;
        blockNumber?: BN;
        transactionIndex?: number;
        size?: number;
    };
    /**
     * Get the size of the total transaction
     */
    get size(): number;
    /**
     * Assign attribute according to the given value
     * @param block Block
     * @param transactionIndex Transaction index
     * @returns The transction object
     */
    installProperties(block: Block, transactionIndex: number): this;
    /**
     * Convert the transaction into json form so that can be transported by rpc port
     * @returns Converted Json object
     */
    toRPCJSON(): {
        blockHash: string | null;
        blockNumber: string | null;
        from: string;
        gas: string;
        gasPrice: string;
        hash: string;
        input: string;
        nonce: string;
        to: string | null;
        transactionIndex: string | null;
        value: string;
        v: string | undefined;
        r: string | undefined;
        s: string | undefined;
    };
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