# @gxchain2/core
[![NPM Version](https://img.shields.io/npm/v/@gxchain2/core)](https://www.npmjs.org/package/@gxchain2/core)
[![Install Size](https://packagephobia.now.sh/badge?p=@gxchain2/core)](https://packagephobia.now.sh/result?p=@gxchain2/core)
![License](https://img.shields.io/npm/l/@gxchain2/core)


The core logic of blockchain node, including:
- `BlockchainMonitor` contains several events
  
   - logs: When a new transaction's log is generated, respond.
   - removedLogs: When the transaction rolled back, respond.
   - newHeads: Respond to the new blockHeads.
  
- `Indexer` and `BloomBitsFilter` : Index of chain and Bloom filter to find blocks and transactions.
  
- `Miner` : Calculate and generate blocks.
  
- `Protocols` : Used for communication and data transmission between nodes
  
- `Txpool` : Txpool contains all transactions obtained from local and network
  
- `Sync` : Synchronize blocks

- `Txsync`: Synchronize transactions

- `Tracer`: Tracer provides an implementation of trace block or transaction

## INSTALL

```sh
npm install @gxchain2/core
```

## STRUCTURE
- `BlockchainMonitor`
```ts
/**
 * Events for new transactions and blocks in the blockchain
 */
export declare interface BlockchainMonitor {
    on(event: 'logs' | 'removedLogs', listener: (logs: Log[]) => void): this;
    on(event: 'newHeads', listener: (hashes: Buffer[]) => void): this;
    once(event: 'logs' | 'removedLogs', listener: (logs: Log[]) => void): this;
    once(event: 'newHeads', listener: (hashes: Buffer[]) => void): this;
}
/**
 * BlockchainMonitor is used to monitor changes on the chain
 */
export declare class BlockchainMonitor extends EventEmitter {
    private readonly node;
    private readonly initPromise;
    private currentHeader;
    constructor(node: Node);
    /**
     * initialization
     */
    init(): Promise<void>;
    /**
     * After getting a new block, this method will compare it with the latest block in the local database, find their
     * common ancestor and record the new transactions, blockheads, or transactions which need to rolled back, then
     * emit the corresponding events
     *
     * @param block New Block data
     */
    newBlock(block: Block): Promise<void>;
}

  ```

- `Miner`
```ts
/**
 * Miner creates blocks and searches for proof-of-work values.
 */
export declare class Miner {
    private readonly node;
    private readonly initPromise;
    private enable;
    private _coinbase;
    private _gasLimit;
    private wvm;
    private pendingTxs;
    private pendingHeader;
    private gasUsed;
    private lock;
    private timeout?;
    private nextTd?;
    private history;
    constructor(options: MinerOptions);
    /**
     * Get the mining state
     */
    get isMining(): boolean;
    /**
     * Get the coinbase
     */
    get coinbase(): Address;
    /**
     * Get the limit of gas
     */
    get gasLimit(): BN;
    /**
     * Set the coinbase
     * @param coinbase
     */
    setCoinbase(coinbase: Address): Promise<void>;
    /**
     * Set the gas limit
     * @param gasLimit
     */
    setGasLimit(gasLimit: BN): void;
    private _pushToHistory;
    private _getPendingBlockByParentHash;
    /**
     * Initialize the miner
     * @returns
     */
    init(): Promise<void>;
    /**
     * Assembles the new block
     * @param header
     */
    newBlockHeader(header: BlockHeader): Promise<void>;
    private makeHeader;
    private _newBlockHeader;
    /**
     * Add transactions for commit
     * @param txs - The map of Buffer and array of transactions
     */
    addTxs(txs: Map<Buffer, TypedTransaction[]>): Promise<void>;
    /**
     * Assembles the pending block from block data
     * @returns
     */
    getPendingBlock(): Promise<Block>;
    getPendingStateManager(): Promise<StateManager>;
    /**
     * Pack different pending block headers according to whether the node produces blocks
     * @param tx
     */
    private _putTx;
    /**
     * _commit runs any post-transaction state modifications,
     * check whether the fees of all transactions exceed the standard
     * @param pendingMap All pending transactions
     */
    private _commit;
}
```

- `Sync`
```ts
```

- Txsync
- Txpool
- Tracer
- 
## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
