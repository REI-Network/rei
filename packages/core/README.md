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
- `bloombit`

```ts
/**
 * Represents a Bloom filter.
 */
export declare class BloomBitsFilter {
    private readonly node;
    private readonly sectionSize;
    constructor(options: BloomBitsFilterOptions);
    /**
     * Check if log is mactched in the given range
     * @param log The log to be checked
     * @param param1 Range parameter, inlcude address, topics, start block number, endb block number
     * @returns `true` if matched
     */
    static checkLogMatches(log: Log, { addresses, topics, from, to }: {
        addresses: Address[];
        topics: Topics;
        from?: BN;
        to?: BN;
    }): boolean;
    /**
     * Find logs which are matched by given range in this block
     * @param block Blcok to be checked
     * @param addresses Given address range
     * @param topics Given topics range
     * @returns The logs meet the conditions
     */
    private checkBlockMatches;
    /**
     * Returns an array of all logs matching filter with given range
     * @param from Number of block at beginning of range
     * @param to The end block number
     * @param addresses Addresses which meet the requirements
     * @param topics Topics which meet the requirements
     * @returns All logs that meet the conditions
     */
    filterRange(from: BN, to: BN, addresses: Address[], topics: Topics): Promise<Log[]>;
    /**
     * Get the qualified logs in a block
     * @param blockHashOrNumber The block to be filtered
     * @param addresses Addresses which meet the requirements
     * @param topics Topics which meet the requirements
     * @returns All logs that meet the conditions
     */
    filterBlock(blockHashOrNumber: Buffer | BN | number, addresses: Address[], topics: Topics): Promise<Log[]>;
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
/**
 * FullSynchronizer represents full syncmode based on Synchronizer
 */
export declare class FullSynchronizer extends Synchronizer {
    private readonly count;
    private readonly limit;
    private readonly fetcher;
    private bestPeerHandler?;
    private bestHeight?;
    private bestTD?;
    private syncingPromise?;
    constructor(options: FullSynchronizerOptions);
    /**
     * Judge the sync state
     */
    get isSyncing(): boolean;
    /**
     * Syncing switch to the peer if the peer's block height is more than the bestHeight
     * @param peer - remote peer
     */
    announce(peer: Peer): void;
    /**
     * Fetch all blocks from current height up to highest found amongst peers
     * @param  peer remote peer to sync with
     * @return Resolves with true if sync successful
     */
    protected _sync(peer?: Peer): Promise<boolean>;
    /**
     * Abort the sync
     */
    abort(): Promise<void>;
    private _tryToGetHeader;
    private _findAncient;
    /**
     * Find the same highest block with the local and target node
     * @param handler WireProtocolHandler of peer
     * @returns The number of block
     */
    private findAncient;
    /**
     * Sync all blocks and state from peer starting from current height.
     * @param handler WireProtocolHandler of remote peer to sync with
     * @param bestHeight The highest height of the target node
     * @return Resolves when sync completed
     */
    private syncWithPeerHandler;
}
```

- Txsync

```ts
/**
 * TxFetcher is responsible for retrieving new transaction based on announcements.
 */
export declare class TxFetcher {
    private waitingList;
    private waitingTime;
    private watingSlots;
    private announces;
    private announced;
    private fetching;
    private requests;
    private alternates;
    private aborter;
    private newPooledTransactionQueue;
    private enqueueTransactionQueue;
    private readonly node;
    private waitTimeout?;
    constructor(node: Node);
    /**
     * Circulate processing of newly entered transactions in the pool
     */
    private newPooledTransactionLoop;
    /**
     * enqueueTransactionLoop imports a batch of received transaction into the transaction pool
     * and the fetcher
     */
    private enqueueTransactionLoop;
    /**
     * rescheduleWait iterates over all the transactions currently in the waitlist
     * and schedules the movement into the fetcher for the earliest.
     */
    private rescheduleWait;
    /**
     * scheduleFetches starts a batch of retrievals for all available idle peers.
     * @param whiteList Given set of active peers
     * @returns
     */
    private scheduleFetches;
    /**
     * Detect and delete timed out requests
     * @param peer peer name
     */
    private requestTimeout;
    /**
     * dropPeer should be called when a peer disconnects. It cleans up all the internal
     * data structures of the given node
     * @param peer
     */
    dropPeer(peer: string): void;
    /**
     * Imports a batch of received transactions' hashes into the transaction pool
     * @param origin - the peer
     * @param hashes - transactions' hashes
     */
    newPooledTransactionHashes(origin: string, hashes: Buffer[]): void;
    /**
     * Imports a batch of received transaction into the transaction pool
     * @param origin - the peer
     * @param txs - transactions
     */
    enqueueTransaction(origin: string, txs: TypedTransaction[]): void;
}
```
- Txpool

```ts
/**
 * TxPool contains all currently known transactions. Transactions
 * enter the pool when they are received from the network or submitted
 * locally. They exit the pool when they are included in the blockchain.
 */
export declare class TxPool extends EventEmitter {
    private aborter;
    private readonly accounts;
    private readonly locals;
    private readonly txs;
    private readonly node;
    private readonly initPromise;
    private readonly rejournalLoopPromise;
    private currentHeader;
    private currentStateManager;
    private txMaxSize;
    private priceLimit;
    private priceBump;
    private accountSlots;
    private globalSlots;
    private accountQueue;
    private globalQueue;
    private globalAllSlots;
    private priced;
    private journal?;
    private lifetime;
    private timeoutInterval;
    private rejournalInterval;
    constructor(options: TxPoolOptions);
    private local;
    private timeoutLoop;
    private rejournalLoop;
    private emitReadies;
    /**
     * Initialize the tx-pool
     * @returns
     */
    init(): Promise<void>;
    abort(): Promise<void>;
    private getAccount;
    /**
     * New a block
     * @param newBlock - Block to create
     */
    newBlock(newBlock: Block): Promise<void>;
    /**
     * Add the transactions into the pool
     * @param txs - transaction or transactions
     * @returns The array of judgments of whether was successfully added
     */
    addTxs(txs: TypedTransaction | TypedTransaction[]): Promise<{
        results: boolean[];
        readies?: Map<Buffer, TypedTransaction[]> | undefined;
    }>;
    /**
     * Obtain the pending transactions in the pool
     * @returns The map of accounts and pending transactions
     */
    getPendingTxMap(number: BN, hash: Buffer): Promise<PendingTxMap>;
    /**
     * Obtain transactions' hashes in the pool
     * @returns The array of hashes
     */
    getPooledTransactionHashes(): Buffer[];
    /**
     * Obtain the transaction in the pool
     * @param hash - the hash of transaction
     * @returns The transaction
     */
    getTransaction(hash: Buffer): TypedTransaction | undefined;
    getPoolContent(): {
        pending: {
            [address: string]: {
                [nonce: string]: any;
            };
        };
        queued: {
            [address: string]: {
                [nonce: string]: any;
            };
        };
    };
    getCurrentHeader(): [BN, Buffer];
    private _addTxs;
    private removeTxFromGlobal;
    private validateTx;
    private enqueueTx;
    private promoteTx;
    private promoteExecutables;
    private demoteUnexecutables;
    private truncatePending;
    private truncateQueue;
    /**
     * List the state of the tx-pool
     */
    ls(): Promise<void>;
}
```
- Tracer
  
```ts
/**
 * Tracer provides an implementation of Tracer that evaluates a Javascript
 * function for each VM execution step.
 */
export declare class Tracer {
    private readonly node;
    constructor(node: Node);
    /**
     * Select the debug mode and generate the return object
     * @param opcodes Opcodes collection
     * @param reject Reject function
     * @param config Trace Config
     * @param hash
     * @returns Debug object
     */
    private createDebugImpl;
    /**
     * TraceBlock achieve to trace the block again by building a vm,
     * run the block in it, and return result of execution
     * @param block Block object
     * @param config Trace config
     * @param hash
     * @returns Result of execution
     */
    traceBlock(block: Block | Buffer, config?: TraceConfig, hash?: Buffer): Promise<any>;
    /**
     * TraceBlockByHash call the traceBlock by using the block hash
     * @param hash Block hash
     * @param config Trace config
     * @returns Result of execution
     */
    traceBlockByHash(hash: Buffer, config?: TraceConfig): Promise<any>;
    /**
     * traceTx trace a transaction by trace a block which the
     * transaction belong to
     * @param hash Transaction hash
     * @param config Trace config
     * @returns Result of execution
     */
    traceTx(hash: Buffer, config?: TraceConfig): Promise<any>;
    /**
     * traceCall trace given transaction by call vm.runCall fucntion
     * @param data Given data
     * @param block Block object
     * @param config Trace config
     * @returns Result of execution
     */
    traceCall(data: {
        from?: string;
        to?: string;
        gas?: string;
        gasPrice?: string;
        value?: string;
        data?: string;
    }, block: Block, config?: TraceConfig): Promise<any>;
}
```
## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)
