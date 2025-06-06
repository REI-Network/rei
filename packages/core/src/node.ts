import path from 'path';
import type { LevelUp } from 'levelup';
import { bufferToHex, BN, BNLike } from 'ethereumjs-util';
import { SecureTrie as Trie } from '@rei-network/trie';
import {
  Database,
  createLevelDB,
  createEncodingLevelDB
} from '@rei-network/database';
import { NetworkManager, Peer, Protocol } from '@rei-network/network';
import { Common } from '@rei-network/common';
import { Blockchain } from '@rei-network/blockchain';
import { VM } from '@rei-network/vm';
import { EVMWorkMode } from '@rei-network/vm/dist/evm/evm';
import { Transaction, Block, Receipt } from '@rei-network/structure';
import { Channel, logger } from '@rei-network/utils';
import { AccountManager } from '@rei-network/wallet';
import { BlsManager } from '@rei-network/bls';
import { TxPool } from './txpool';
import { Synchronizer, SyncMode } from './sync';
import { TxFetcher } from './txSync';
import { BloomBitsIndexer, ChainIndexer } from './indexer';
import { BloomBitsFilter, ReceiptsCache } from './bloomBits';
import { Tracer } from './tracer';
import { BlockchainMonitor } from './blockchainMonitor';
import {
  Wire,
  ConsensusProtocol,
  WireProtocolHandler,
  SnapProtocol,
  SnapProtocolHandler
} from './protocols';
import { ReimintEngine, Reimint } from './reimint';
import { NodeOptions, NodeStatus } from './types';
import { StateManager } from './stateManager';
import { SnapTree } from './snap/snapTree';

const maxSnapLayers = 1024;
const defaultTimeoutBanTime = 60 * 5 * 1000;
const defaultInvalidBanTime = 60 * 10 * 1000;
const defaultChainName = 'rei-mainnet';
const defaultEVMWorkMode = EVMWorkMode.JS;
const defaultSyncMode = SyncMode.Full;

type PendingTxs = {
  txs: Transaction[];
  resolve: (results: boolean[]) => void;
};

type CommitBlock = {
  options: CommitBlockOptions;
  resolve: (result: boolean) => void;
  reject: (reason?: any) => void;
};

export interface CommitBlockOptions {
  broadcast: boolean;
  block: Block;
  receipts: Receipt[];
  force?: boolean;
  td?: BN;
}

export class Node {
  readonly datadir: string;
  readonly chain: string;
  readonly networkId: number;
  readonly chainId: number;
  readonly genesisHash: Buffer;
  readonly nodedb: LevelUp;
  readonly chaindb: LevelUp;
  readonly chaindbDown: any;
  readonly evidencedb: LevelUp;
  readonly wire: Wire;
  readonly consensus: ConsensusProtocol;
  readonly snap: SnapProtocol;
  readonly db: Database;
  readonly blockchain: Blockchain;
  readonly networkMngr: NetworkManager;
  readonly sync: Synchronizer;
  readonly txPool: TxPool;
  readonly txSync: TxFetcher;
  readonly bloomBitsIndexer: ChainIndexer;
  readonly bcMonitor: BlockchainMonitor;
  readonly accMngr: AccountManager;
  readonly reimint: ReimintEngine;
  readonly receiptsCache: ReceiptsCache;
  readonly snapTree?: SnapTree;
  readonly evmWorkMode: EVMWorkMode;
  readonly blsMngr: BlsManager;
  readonly skipVerifySnap?: boolean;

  private initPromise?: Promise<void>;
  private pendingTxsLoopPromise?: Promise<void>;
  private commitBlockLoopPromise?: Promise<void>;

  private readonly pendingTxsQueue = new Channel<PendingTxs>({
    drop: ({ txs, resolve }) => {
      resolve(new Array<boolean>(txs.length).fill(false));
    }
  });
  private readonly commitBlockQueue = new Channel<CommitBlock>({
    drop: ({ reject }) => {
      reject(new Error('aborted'));
    }
  });

  constructor(options: NodeOptions) {
    this.datadir = options.databasePath;
    [this.chaindb, this.chaindbDown] = createEncodingLevelDB(
      path.join(this.datadir, 'chaindb')
    );
    [this.nodedb] = createLevelDB(path.join(this.datadir, 'nodes'));
    [this.evidencedb] = createLevelDB(path.join(this.datadir, 'evidence'));
    this.wire = new Wire(this);
    this.consensus = new ConsensusProtocol(this);
    this.snap = new SnapProtocol(this);
    this.accMngr = new AccountManager(options.keyStorePath);
    this.receiptsCache = new ReceiptsCache(options.receiptsCacheSize);
    this.evmWorkMode = options.evmWorkMode ?? defaultEVMWorkMode;
    this.blsMngr = new BlsManager(options.blsPath);
    this.skipVerifySnap = options.skipVerifySnap;

    this.chain = options.chain ?? defaultChainName;
    if (!Common.isSupportedChainName(this.chain)) {
      throw new Error(`Unknown chain: ${this.chain}`);
    }

    const common = this.getCommon(0);
    this.db = new Database(this.chaindb, common);
    this.networkId = common.networkIdBN().toNumber();
    this.chainId = common.chainIdBN().toNumber();
    this.reimint = new ReimintEngine({
      node: this,
      coinbase: options.coinbase
    });

    const genesisBlock = Block.fromBlockData(
      { header: common.genesis() },
      { common }
    );
    this.genesisHash = genesisBlock.hash();
    logger.info('Read genesis block from file', bufferToHex(this.genesisHash));

    this.blockchain = new Blockchain({
      database: this.db,
      common,
      genesisBlock,
      validateBlocks: false,
      validateConsensus: false,
      hardforkByHeadBlockNumber: true
    });

    const protocols: (Protocol | Protocol[])[] = [
      [this.wire.v2, this.wire.v1],
      this.consensus
    ];
    // enable the snapshot protocol only when the snapshot is synchronized
    if (options.syncMode === SyncMode.Snap) {
      protocols.push(this.snap);
    }

    this.networkMngr = new NetworkManager({
      peerId: options.peerId,
      protocols,
      nodedb: this.nodedb,
      libp2pOptions: {
        tcpPort: options.tcpPort,
        udpPort: options.udpPort,
        bootnodes: [...common.bootstrapNodes(), ...(options.bootnodes ?? [])]
      }
    })
      .on('installed', this.onPeerInstalled)
      .on('removed', this.onPeerRemoved);
    this.sync = new Synchronizer({
      node: this,
      mode: options.syncMode ?? defaultSyncMode,
      snapSyncMinTD: options.snapSyncMinTD,
      trustedHash: options.trustedHash,
      trustedHeight: options.trustedHeight
    })
      .on('synchronized', this.onSyncOver)
      .on('failed', this.onSyncOver);
    this.txPool = new TxPool({
      node: this,
      journal: this.datadir
    });
    this.txSync = new TxFetcher(this);
    this.bcMonitor = new BlockchainMonitor(this.db);
    this.bloomBitsIndexer = BloomBitsIndexer.createBloomBitsIndexer({
      db: this.db
    });

    // enable snapshot generation only during snapshot synchronization
    if (options.syncMode === SyncMode.Snap) {
      this.snapTree = new SnapTree(this.db);
    }
  }

  /**
   * Get blockchain's latest block
   */
  get latestBlock() {
    return this.blockchain.latestBlock;
  }

  /**
   * Get blockchain's total difficulty
   */
  get totalDifficulty() {
    return this.blockchain.totalDifficulty;
  }

  /**
   * Get the status of the node syncing
   */
  get status(): NodeStatus {
    return {
      networkId: this.networkId,
      totalDifficulty: this.totalDifficulty.toArrayLike(Buffer),
      height: this.latestBlock.header.number.toNumber(),
      bestHash: this.latestBlock.hash(),
      genesisHash: this.genesisHash
    };
  }

  /**
   * Initialize node
   */
  init() {
    if (this.initPromise) {
      return this.initPromise;
    }

    return (this.initPromise = (async () => {
      await this.chaindb.open();
      await this.nodedb.open();
      await this.evidencedb.open();

      await this.blsMngr.init();
      await this.blockchain.init();

      const latest = this.latestBlock.header;
      if (latest.number.eqn(0)) {
        await this.reimint.generateGenesis();
      }

      if (
        this.snapTree &&
        (await this.snapTree.init(latest.stateRoot, false, true)) &&
        !this.skipVerifySnap
      ) {
        logger.info('📷 Verifing snaphot...');
        if (!(await this.snapTree.verify(latest.stateRoot))) {
          logger.warn('Node::init, verify snapshot failed, rebuilding...');
          const { generating } = await this.snapTree.rebuild(latest.stateRoot);
          await generating;
        }
      }

      await this.txPool.init(this.latestBlock);
      await this.reimint.init();
      await this.bloomBitsIndexer.init();
      await this.bcMonitor.init(latest);
      await this.networkMngr.init();

      // check whether the snapshot index is created during initialization
      await this.bloomBitsIndexer.processNewHeader(latest.number, true);
    })());
  }

  /**
   * Start node
   */
  start() {
    this.sync.start();
    this.txPool.start();
    this.txSync.start();
    this.bloomBitsIndexer.start();
    this.networkMngr.start();
    this.reimint.start();

    this.pendingTxsLoopPromise = this.pendingTxsLoop();
    this.commitBlockLoopPromise = this.commitBlockLoop();

    // start mint
    this.tryToMintNextBlock();
  }

  /**
   * Abort node
   */
  async abort() {
    this.sync.off('synchronized', this.onSyncOver);
    this.sync.off('failed', this.onSyncOver);
    this.networkMngr.off('installed', this.onPeerInstalled);
    this.networkMngr.off('removed', this.onPeerRemoved);
    this.pendingTxsQueue.abort();
    this.commitBlockQueue.abort();
    this.txSync.abort();

    const promises = [
      this.reimint.abort(),
      this.networkMngr.abort(),
      this.sync.abort(),
      this.txPool.abort(),
      this.bloomBitsIndexer.abort(),
      this.pendingTxsLoopPromise,
      this.commitBlockLoopPromise
    ];
    if (this.snapTree) {
      promises.push(this.snapTree.abort(this.latestBlock.header.stateRoot));
    }

    await Promise.all(promises);

    await this.evidencedb.close();
    await this.nodedb.close();
    await this.chaindb.close();
  }

  private onPeerInstalled = (peer, handler) => {
    if (
      handler instanceof WireProtocolHandler ||
      handler instanceof SnapProtocolHandler
    ) {
      this.sync.announceNewPeer(handler);
    }
  };

  private onPeerRemoved = (peer: Peer) => {
    this.txSync.dropPeer(peer.peerId);
  };

  private onSyncOver = () => {
    this.tryToMintNextBlock();
  };

  /**
   * It will try to continue mint a new block after the latest block
   */
  tryToMintNextBlock() {
    this.reimint.tryToMintNextBlock(this.latestBlock);
  }

  /**
   * Get common object by block number
   * @param num - Block number
   * @returns Common object
   */
  getCommon(num: BNLike) {
    const common = new Common({
      chain: this.chain
    });
    common.setHardforkByBlockNumber(num);
    return common;
  }

  /**
   * Get latest block common instance
   * @returns Common instance
   */
  getLatestCommon() {
    return this.latestBlock._common.copy();
  }

  /**
   * Get latest block
   * @returns Latest block
   */
  getLatestBlock() {
    return this.latestBlock;
  }

  /**
   * Get latest block total difficulty
   * @returns Total difficulty
   */
  getTotalDifficulty() {
    return this.totalDifficulty.clone();
  }

  /**
   * Get state manager object by state root
   * @param root - State root
   * @param num - Block number or Common
   * @param snap - Need snapshot or not
   * @returns State manager object
   */
  async getStateManager(root: Buffer, num: BNLike | Common, snap = false) {
    const stateManager = new StateManager({
      common: num instanceof Common ? num : this.getCommon(num),
      trie: new Trie(this.chaindb),
      snapTree: snap ? this.snapTree : undefined
    });
    await stateManager.setStateRoot(root);
    return stateManager;
  }

  /**
   * Get a VM object by state root
   * @param root - The state root
   * @param num - Block number or Common
   * @param snap - Need snapshot or not
   * @param mode - EVM work mode
   * @returns VM object
   */
  async getVM(
    root: Buffer,
    num: BNLike | Common,
    snap = false,
    mode?: EVMWorkMode
  ) {
    const stateManager = await this.getStateManager(root, num, snap);
    const common = stateManager._common;
    return new VM({
      common,
      stateManager,
      blockchain: this.blockchain,
      mode: mode ?? this.evmWorkMode,
      exposed: this.chaindbDown.exposed,
      getMiner: (header) => Reimint.getMiner(header)
    });
  }

  /**
   * Create a new bloom filter
   * @returns Bloom filter object
   */
  getFilter() {
    return new BloomBitsFilter(this);
  }

  /**
   * Create a new tracer
   * @returns Tracer object
   */
  getTracer() {
    return new Tracer(this);
  }

  /**
   * Get current pending block,
   * if current pending block doesn't exist,
   * it will return an empty block
   * @returns Pending block
   */
  getPendingBlock() {
    const pendingBlock = this.reimint.worker.getPendingBlock();
    const lastest = this.latestBlock;
    if (pendingBlock) {
      // TODO: transactions
      const { header, transactions } = pendingBlock.makeBlockData();
      header.stateRoot = header.stateRoot ?? lastest.header.stateRoot;
      return this.reimint.generatePendingBlock(header, pendingBlock.common);
    } else {
      const nextNumber = lastest.header.number.addn(1);
      return this.reimint.generatePendingBlock(
        {
          parentHash: lastest.hash(),
          stateRoot: lastest.header.stateRoot,
          number: nextNumber
        },
        this.getCommon(nextNumber)
      );
    }
  }

  /**
   * Get pending state manager instance
   * @returns State manager instance
   */
  getPendingStateManager() {
    const pendingBlock = this.reimint.worker.getPendingBlock();
    if (pendingBlock) {
      return this.getStateManager(
        pendingBlock.pendingStateRoot,
        pendingBlock.common
      );
    } else {
      const latest = this.latestBlock;
      return this.getStateManager(latest.header.stateRoot, latest._common);
    }
  }

  private async doCommitBlock(opts: CommitBlockOptions) {
    const { block, receipts } = opts;

    const hash = block.hash();
    const number = block.header.number;
    const root = block.header.stateRoot;

    // ensure that the block has not been committed
    try {
      const hashInDB = await this.db.numberToHash(number);
      if (hashInDB.equals(hash)) {
        return { reorged: false };
      }
    } catch (err: any) {
      if (err.type !== 'NotFoundError') {
        throw err;
      }
    }

    // if we are now under the reimint consensus,
    // we will refuse to roll back the block
    if (block.header.number.lte(this.latestBlock.header.number)) {
      throw new Error('reimint revert');
    }

    // save block to the database
    let reorged: boolean;
    if (opts.force) {
      if (opts.td === undefined) {
        throw new Error('missing total difficulty');
      }
      reorged = await this.blockchain.forcePutBlock(block, {
        td: opts.td,
        receipts,
        saveTxLookup: true
      });
    } else {
      reorged = await this.blockchain.putBlock(block, {
        receipts,
        saveTxLookup: true
      });
    }

    if (this.snapTree) {
      // discard and cap snap tree
      try {
        this.snapTree.discard(root);
        await this.snapTree.cap(root, maxSnapLayers);
      } catch (err) {
        logger.warn('Node::doCommitBlock, cap snap tree failed:', err);
      }
    }

    // install properties for receipts
    let lastCumulativeGasUsed = new BN(0);
    for (let i = 0; i < receipts.length; i++) {
      const receipt = receipts[i];
      const gasUsed = receipt.bnCumulativeGasUsed.sub(lastCumulativeGasUsed);
      receipt.initExtension(
        block,
        block.transactions[i] as Transaction,
        gasUsed,
        i
      );
      lastCumulativeGasUsed = receipt.bnCumulativeGasUsed;
    }

    // add receipts to cache
    this.receiptsCache.add(hash, receipts);

    logger.info(
      '✨ Commit block, height:',
      number.toString(),
      'hash:',
      bufferToHex(hash)
    );

    return { reorged };
  }

  /**
   * A loop that executes blocks sequentially
   */
  private async commitBlockLoop() {
    await this.initPromise;
    for await (const { options, resolve, reject } of this.commitBlockQueue) {
      try {
        const { block, broadcast, force } = options;
        const { reorged } = await this.doCommitBlock(options);

        // if canonical chain changes, notify to other modules
        if (reorged) {
          if (broadcast) {
            this.wire.broadcastNewBlock(block, this.totalDifficulty);
          }

          const promises = [
            this.txPool.newBlock(block, force),
            this.bcMonitor.newBlock(block, force),
            this.bloomBitsIndexer.newBlockHeader(block.header, force),
            this.reimint.newBlock(block)
          ];
          await Promise.all(promises);
        }

        resolve(reorged);
      } catch (err) {
        reject(err);
      }
    }
  }

  /**
   * A loop that adds pending transaction
   */
  private async pendingTxsLoop() {
    await this.initPromise;
    for await (const task of this.pendingTxsQueue) {
      try {
        const { results, readies } = await this.txPool.addTxs(task.txs);
        if (readies && readies.size > 0) {
          const hashes = Array.from(readies.values())
            .reduce((a, b) => a.concat(b), [])
            .map((tx) => tx.hash());
          for (const handler of this.wire.pool.handlers) {
            handler.announceTx(hashes);
          }
          await this.reimint.addTxs(readies);
        }
        task.resolve(results);
      } catch (err) {
        task.resolve(new Array<boolean>(task.txs.length).fill(false));
        logger.error('Node::taskLoop, catch error:', err);
      }
    }
  }

  /**
   * Push a block to the commit block queue
   * @param options - Commit block options
   * @returns Reorged
   */
  async commitBlock(options: CommitBlockOptions) {
    await this.initPromise;
    return new Promise<boolean>((resolve, reject) => {
      this.commitBlockQueue.push({
        options,
        resolve,
        reject
      });
    });
  }

  /**
   * Add pending transactions to consensus engine
   * @param txs - Pending transactions
   * @returns An array of results, one-to-one correspondence with transactions
   */
  async addPendingTxs(txs: Transaction[]) {
    await this.initPromise;
    return new Promise<boolean[]>((resolve) => {
      this.pendingTxsQueue.push({ txs, resolve });
    });
  }

  /**
   * Ban peer
   * @param peerId - Target peer
   * @param reason - Ban reason
   */
  async banPeer(peerId: string, reason: 'invalid' | 'timeout') {
    logger.debug('Node::banPeer, peerId:', peerId, 'reason:', reason);
    if (reason === 'invalid') {
      await this.networkMngr.ban(peerId, defaultInvalidBanTime);
    } else {
      await this.networkMngr.ban(peerId, defaultTimeoutBanTime);
    }
  }
}
