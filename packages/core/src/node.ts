import path from 'path';
import fs from 'fs';
import type { LevelUp } from 'levelup';
import LevelStore from 'datastore-level';
import { bufferToHex, BN, BNLike, Address } from 'ethereumjs-util';
import { SecureTrie as Trie } from 'merkle-patricia-tree';
import PeerId from 'peer-id';
import { Database, createEncodingLevelDB, createLevelDB, DBSaveTxLookup, DBSaveReceipts } from '@gxchain2/database';
import { NetworkManager, Peer } from '@gxchain2/network';
import { Common, getGenesisState, getChain } from '@gxchain2/common';
import { Blockchain } from '@gxchain2/blockchain';
import VM from '@gxchain2-ethereumjs/vm';
import EVM from '@gxchain2-ethereumjs/vm/dist/evm/evm';
import TxContext from '@gxchain2-ethereumjs/vm/dist/evm/txContext';
import { DefaultStateManager as StateManager } from '@gxchain2-ethereumjs/vm/dist/state';
import { Transaction, Block } from '@gxchain2/structure';
import { Channel, Aborter, logger } from '@gxchain2/utils';
import { AccountManager } from '@gxchain2/wallet';
import { TxPool } from './txpool';
import { FullSynchronizer, Synchronizer } from './sync';
import { TxFetcher } from './txSync';
import { BloomBitsIndexer, ChainIndexer } from './indexer';
import { BloomBitsFilter, BloomBitsBlocks, ConfirmsBlockNumber } from './bloombits';
import { BlockchainMonitor } from './blockchainMonitor';
import { createProtocolsByNames, NetworkProtocol, WireProtocol } from './protocols';
import { ValidatorSets } from './staking';
import { StakeManager, Router } from './contracts';
import { createEnginesByConsensusTypes, ConsensusEngine, ConsensusType, ProcessBlockOpts } from './consensus';
import { ReimintConsensusEngine } from './consensus/reimint/reimintConsensusEngine';
import { CliqueConsensusEngine } from './consensus/clique/cliqueConsensusEngine';
import { postByzantiumTxReceiptsToReceipts, EMPTY_ADDRESS } from './utils';
import { getConsensusTypeByCommon } from './hardforks';

const defaultTimeoutBanTime = 60 * 5 * 1000;
const defaultInvalidBanTime = 60 * 10 * 1000;
const defaultChainName = 'gxc2-mainnet';

export type NodeStatus = {
  networkId: number;
  totalDifficulty: Buffer;
  height: number;
  bestHash: Buffer;
  genesisHash: Buffer;
};

export interface NodeOptions {
  /**
   * Full path of database
   */
  databasePath: string;
  /**
   * Chain name, default is `gxc2-mainnet`
   */
  chain?: string | { chain: any; genesisState?: any };
  mine: {
    /**
     * Enable miner
     */
    enable: boolean;
    /**
     * Enable miner debug mode,
     * in debug mode, miners will not mint empty block
     */
    debug?: boolean;
    /**
     * Miner coinbase,
     * if miner is enable, this option must be passed in
     */
    coinbase?: string;
  };
  p2p: {
    /**
     * Enable p2p server
     */
    enable: boolean;
    /**
     * TCP listening port
     */
    tcpPort?: number;
    /**
     * Discv5 UDP listening port
     */
    udpPort?: number;
    /**
     * NAT ip address
     */
    nat?: string;
    /**
     * Bootnodes list
     */
    bootnodes?: string[];
    /**
     * Maximum number of peers
     */
    maxPeers?: number;
    /**
     * Maximum number of simultaneous dialing
     */
    maxDials?: number;
  };
  account: {
    /**
     * Keystore full path
     */
    keyStorePath: string;
    /**
     * Unlock account list,
     * [[address, passphrase], [address, passphrase], ...]
     */
    unlock: [string, string][];
  };
}

export interface ProcessBlockOptions extends Omit<ProcessBlockOpts, 'block' | 'root'> {
  broadcast: boolean;
}

type PendingTxs = {
  txs: Transaction[];
  resolve: (results: boolean[]) => void;
};

type ProcessBlock = {
  block: Block;
  options: ProcessBlockOptions;
  resolve: (result: boolean) => void;
  reject: (reason?: any) => void;
};

export class Node {
  public readonly chaindb: LevelUp;
  public readonly nodedb: LevelUp;
  public readonly evidencedb: LevelUp;
  public readonly networkdb: LevelStore;
  public readonly datadir: string;
  public readonly aborter = new Aborter();

  public db!: Database;
  public networkMngr!: NetworkManager;
  public blockchain!: Blockchain;
  public sync!: Synchronizer;
  public txPool!: TxPool;
  public txSync!: TxFetcher;
  public bloomBitsIndexer!: ChainIndexer;
  public bcMonitor!: BlockchainMonitor;
  public accMngr!: AccountManager;

  public readonly validatorSets = new ValidatorSets();

  private readonly initPromise: Promise<void>;
  private readonly taskLoopPromise: Promise<void>;
  private readonly processLoopPromise: Promise<void>;
  private readonly taskQueue = new Channel<PendingTxs>();
  private readonly processQueue = new Channel<ProcessBlock>();

  private engines!: Map<ConsensusType, ConsensusEngine>;
  private chain!: string | { chain: any; genesisState?: any };
  private networkId!: number;
  private chainId!: number;
  private genesisHash!: Buffer;

  constructor(options: NodeOptions) {
    this.datadir = options.databasePath;
    this.chaindb = createEncodingLevelDB(path.join(this.datadir, 'chaindb'));
    this.nodedb = createLevelDB(path.join(this.datadir, 'nodes'));
    this.evidencedb = createLevelDB(path.join(this.datadir, 'evidence'));
    this.networkdb = new LevelStore(path.join(this.datadir, 'networkdb'), { createIfMissing: true });
    this.initPromise = this.init(options);
    this.taskLoopPromise = this.taskLoop();
    this.processLoopPromise = this.processLoop();
  }

  /**
   * Get the status of the node syncing
   */
  get status(): NodeStatus {
    return {
      networkId: this.networkId,
      totalDifficulty: this.blockchain.totalDifficulty.toBuffer(),
      height: this.blockchain.latestHeight,
      bestHash: this.blockchain.latestBlock.hash(),
      genesisHash: this.genesisHash
    };
  }

  private async loadPeerId(databasePath: string) {
    let peerId!: PeerId;
    const nodeKeyPath = path.join(databasePath, 'nodekey');
    try {
      const key = fs.readFileSync(nodeKeyPath);
      peerId = await PeerId.createFromPrivKey(key);
    } catch (err) {
      logger.warn('Read nodekey faild, generate a new key');
      peerId = await PeerId.create({ keyType: 'secp256k1' });
      fs.writeFileSync(nodeKeyPath, peerId.privKey.bytes);
    }
    return peerId;
  }

  /**
   * Initialize the node
   */
  async init(options?: NodeOptions) {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    if (!options) {
      throw new Error('Missing options');
    }

    this.accMngr = new AccountManager(options.account.keyStorePath);
    if (options.account.unlock.length > 0) {
      const result = await Promise.all(options.account.unlock.map(([address, passphrase]) => this.accMngr.unlock(address, passphrase)));
      for (let i = 0; i < result.length; i++) {
        if (!result[i]) {
          throw new Error(`Unlock account ${options.account.unlock[i][0]} failed!`);
        }
      }
    }
    if (options.mine.coinbase && !this.accMngr.hasUnlockedAccount(options.mine.coinbase)) {
      throw new Error(`Unlock coin account ${options.mine.coinbase} failed!`);
    }

    if (options.chain) {
      this.chain = options.chain;
    }
    if (this.chain === undefined) {
      try {
        this.chain = JSON.parse(fs.readFileSync(path.join(this.datadir, 'genesis.json')).toString());
      } catch (err) {
        logger.warn(`Read genesis.json faild, use default chain(${defaultChainName})`);
        this.chain = defaultChainName;
      }
    } else if (getChain(this.chain as string) === undefined) {
      throw new Error(`Unknow chain: ${this.chain}`);
    }

    const common = Common.createChainStartCommon(typeof this.chain === 'string' ? this.chain : this.chain.chain);
    this.db = new Database(this.chaindb, common);
    this.networkId = common.networkIdBN().toNumber();
    this.chainId = common.chainIdBN().toNumber();

    const engineOptions = { node: this, enable: options.mine.enable, coinbase: options.mine.coinbase ? Address.fromString(options.mine.coinbase) : undefined };
    this.engines = createEnginesByConsensusTypes([ConsensusType.Clique, ConsensusType.Reimint], engineOptions);

    let genesisBlock!: Block;
    try {
      const genesisHash = await this.db.numberToHash(new BN(0));
      genesisBlock = await this.db.getBlock(genesisHash);
      logger.info('Find genesis block in db', bufferToHex(genesisHash));
    } catch (error: any) {
      if (error.type !== 'NotFoundError') {
        throw error;
      }
    }

    if (!genesisBlock) {
      genesisBlock = Block.genesis({ header: common.genesis() }, { common });
      logger.info('Read genesis block from file', bufferToHex(genesisBlock.hash()));
      if (typeof this.chain === 'string' || this.chain.genesisState) {
        const stateManager = new StateManager({ common, trie: new Trie(this.chaindb) });
        await stateManager.generateGenesis(typeof this.chain === 'string' ? getGenesisState(this.chain) : this.chain.genesisState);
        const root = await stateManager.getStateRoot();
        if (!root.equals(genesisBlock.header.stateRoot)) {
          logger.error('State root not equal', bufferToHex(root), bufferToHex(genesisBlock.header.stateRoot));
          throw new Error('state root not equal');
        }
      }
    }
    this.genesisHash = genesisBlock.hash();

    common.setHardforkByBlockNumber(0);
    this.blockchain = new Blockchain({
      dbManager: this.db,
      common,
      genesisBlock,
      validateBlocks: false,
      validateConsensus: false,
      hardforkByHeadBlockNumber: true
    });
    await this.blockchain.init();

    this.sync = new FullSynchronizer({ node: this }).on('synchronized', this.onSyncOver).on('failed', this.onSyncOver);
    this.txPool = new TxPool({ node: this, journal: this.datadir });

    const peerId = await this.loadPeerId(this.datadir);
    await this.networkdb.open();

    this.txSync = new TxFetcher(this);

    let bootnodes = options.p2p.bootnodes || [];
    bootnodes = bootnodes.concat(common.bootstrapNodes());
    this.networkMngr = new NetworkManager({
      protocols: createProtocolsByNames(this, [NetworkProtocol.GXC2_ETHWIRE, NetworkProtocol.GXC2_CONSENSUS]),
      datastore: this.networkdb,
      nodedb: this.nodedb,
      peerId,
      ...options.p2p,
      bootnodes
    })
      .on('installed', this.onPeerInstalled)
      .on('removed', this.onPeerRemoved);
    await this.networkMngr.init();

    await this.txPool.init();

    this.bloomBitsIndexer = BloomBitsIndexer.createBloomBitsIndexer({ node: this, sectionSize: BloomBitsBlocks, confirmsBlockNumber: ConfirmsBlockNumber });
    await this.bloomBitsIndexer.init();

    this.bcMonitor = new BlockchainMonitor(this);
    await this.bcMonitor.init();

    // start mint
    this.getCurrentEngine().start();
    this.getCurrentEngine().newBlock(this.blockchain.latestBlock);
  }

  private onPeerInstalled = (peer: Peer) => {
    this.sync.announce(peer);
  };

  private onPeerRemoved = (peer: Peer) => {
    this.txSync.dropPeer(peer.peerId);
  };

  private onSyncOver = () => {
    this.getCurrentEngine().newBlock(this.blockchain.latestBlock);
  };

  /**
   * Mint over callback,
   * it will be called when local node mint a block,
   * it will try to continue mint a new block after the latest block
   */
  onMintBlock() {
    this.getCurrentEngine().newBlock(this.blockchain.latestBlock);
  }

  /**
   * Get common object by block number
   * @param num - Block number
   * @returns Common object
   */
  getCommon(num: BNLike) {
    return Common.createCommonByBlockNumber(num, typeof this.chain === 'string' ? this.chain : this.chain.chain);
  }

  /**
   * Get latest block common instance
   * @returns Common object
   */
  getLatestCommon() {
    return this.blockchain.latestBlock._common;
  }

  /**
   * Get consensus engine by common instance
   * @param common - Common instance
   * @returns Consensus engine
   */
  getEngineByCommon(common: Common) {
    return this.engines.get(getConsensusTypeByCommon(common))!;
  }

  /**
   * Get current working consensus engine
   * @returns Consensus engine
   */
  getCurrentEngine() {
    const nextCommon = this.getCommon(this.blockchain.latestBlock.header.number.addn(1));
    return this.engines.get(getConsensusTypeByCommon(nextCommon))!;
  }

  /**
   * Get clique consensus engine instance,
   * return undefined if clique is disable
   * @returns CliqueConsensusEngine or undefined
   */
  getCliqueEngine() {
    const engine = this.engines.get(ConsensusType.Clique);
    return engine ? (engine as CliqueConsensusEngine) : undefined;
  }

  /**
   * Get reimint consensus engine instance,
   * return undefined if reimint is disable
   * @returns ReimintConsensusEngine or undefined
   */
  getReimintEngine() {
    const engine = this.engines.get(ConsensusType.Reimint);
    return engine ? (engine as ReimintConsensusEngine) : undefined;
  }

  /**
   * Get state manager object by state root
   * @param root - State root
   * @param num - Block number or Common
   * @returns State manager object
   */
  async getStateManager(root: Buffer, num: BNLike | Common) {
    const stateManager = new StateManager({ common: num instanceof Common ? num : this.getCommon(num), trie: new Trie(this.chaindb) });
    await stateManager.setStateRoot(root);
    return stateManager;
  }

  /**
   * Get a VM object by state root
   * @param root - The state root
   * @param num - Block number or Common
   * @returns VM object
   */
  async getVM(root: Buffer, num: BNLike | Common) {
    const stateManager = await this.getStateManager(root, num);
    return new VM({
      common: stateManager._common,
      stateManager,
      blockchain: this.blockchain
    });
  }

  /**
   * Get stake manager contract object
   * @param vm - Target vm instance
   * @param block - Target block
   * @param common - Common instance
   * @returns Stake manager contract object
   */
  getStakeManager(vm: VM, block: Block, common?: Common) {
    const evm = new EVM(vm, new TxContext(new BN(0), EMPTY_ADDRESS), block);
    return new StakeManager(evm, common ?? block._common);
  }

  /**
   * Get router contract object
   * @param vm - Target vm instance
   * @param block - Target block
   * @param common - Common instance
   * @returns Router contract object
   */
  getRouter(vm: VM, block: Block, common?: Common) {
    const evm = new EVM(vm, new TxContext(new BN(0), EMPTY_ADDRESS), block);
    return new Router(evm, common ?? block._common);
  }

  /**
   * Create a new bloom filter
   * @returns Bloom filter object
   */
  getFilter() {
    return new BloomBitsFilter({ node: this, sectionSize: BloomBitsBlocks });
  }

  /**
   * Get chain id
   * @returns Chain id
   */
  getChainId() {
    return this.chainId;
  }

  /**
   * Get current pending block,
   * if current pending block doesn't exsit,
   * it will return an empty block
   * @returns Pending block
   */
  getPendingBlock() {
    const engine = this.getCurrentEngine();
    const pendingBlock = engine.worker.getPendingBlock();
    if (pendingBlock) {
      const { header, transactions } = pendingBlock.makeBlockData();
      return engine.generatePendingBlock(header, pendingBlock.common, transactions);
    } else {
      const lastest = this.blockchain.latestBlock;
      const nextNumber = lastest.header.number.addn(1);
      return engine.generatePendingBlock(
        {
          parentHash: lastest.hash(),
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
  getPendingStakeManager() {
    const engine = this.getCurrentEngine();
    const pendingBlock = engine.worker.getPendingBlock();
    if (pendingBlock) {
      return this.getStateManager(pendingBlock.pendingStateRoot, pendingBlock.common);
    } else {
      const latest = this.blockchain.latestBlock;
      return this.getStateManager(latest.header.stateRoot, latest._common);
    }
  }

  /**
   * A loop that executes blocks sequentially
   */
  private async processLoop() {
    await this.initPromise;
    for await (let { block, options, resolve, reject } of this.processQueue.generator()) {
      try {
        const hash = block.hash();
        const number = block.header.number;
        const common = block._common;
        // ensure that every transaction is in the right common
        for (const tx of block.transactions) {
          tx.common.getHardforkByBlockNumber(number);
        }

        // get parent header from database
        const parent = await this.db.getHeader(block.header.parentHash, number.subn(1));
        // process block through consensus engine
        const { receipts: _receipts, validatorSet } = await this.getEngineByCommon(common).processBlock({ ...options, block, root: parent.stateRoot });
        // convert receipts
        const receipts = postByzantiumTxReceiptsToReceipts(_receipts);

        logger.info('✨ Process block, height:', number.toString(), 'hash:', bufferToHex(hash));

        const before = this.blockchain.latestBlock.hash();

        // commit
        {
          // save validator set if it exists
          validatorSet && this.validatorSets.set(block.header.stateRoot, validatorSet);
          // save block
          await this.blockchain.putBlock(block);
          // save receipts
          await this.db.batch(DBSaveTxLookup(block).concat(DBSaveReceipts(receipts, hash, number)));
        }

        const after = this.blockchain.latestBlock.hash();

        const reorged = !before.equals(after);

        // if canonical chain changes, notify to other modules
        if (reorged) {
          const promises = [this.txPool.newBlock(block), this.bcMonitor.newBlock(block), this.bloomBitsIndexer.newBlockHeader(block.header)];
          if (options.broadcast) {
            promises.push(this.broadcastNewBlock(block));
          }
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
  private async taskLoop() {
    await this.initPromise;
    for await (const task of this.taskQueue.generator()) {
      try {
        const { results, readies } = await this.txPool.addTxs(task.txs);
        if (readies && readies.size > 0) {
          const hashes = Array.from(readies.values())
            .reduce((a, b) => a.concat(b), [])
            .map((tx) => tx.hash());
          for (const handler of WireProtocol.getPool().handlers) {
            handler.announceTx(hashes);
          }
          await this.getCurrentEngine().addTxs(readies);
        }
        task.resolve(results);
      } catch (err) {
        task.resolve(new Array<boolean>(task.txs.length).fill(false));
        logger.error('Node::taskLoop, catch error:', err);
      }
    }
  }

  /**
   * Push a block to the block queue
   * @param block - Block
   * @param options - Process block options
   * @returns Reorged
   */
  async processBlock(block: Block, options: ProcessBlockOptions) {
    await this.initPromise;
    return new Promise<boolean>((resolve, reject) => {
      this.processQueue.push({ block, options, resolve, reject });
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
      this.taskQueue.push({ txs, resolve });
    });
  }

  /**
   * Broadcast new block to all connected peers
   * @param block - Block
   */
  async broadcastNewBlock(block: Block) {
    const td = await this.db.getTotalDifficulty(block.hash(), block.header.number);
    for (const handler of WireProtocol.getPool().handlers) {
      handler.announceNewBlock(block, td);
    }
  }

  /**
   * Ban peer
   * @param peerId - Target peer
   * @param reason - Ban reason
   */
  async banPeer(peerId: string, reason: 'invalid' | 'timeout') {
    if (reason === 'invalid') {
      await this.networkMngr.ban(peerId, defaultInvalidBanTime);
    } else {
      await this.networkMngr.ban(peerId, defaultTimeoutBanTime);
    }
  }

  /**
   * Abort node
   */
  async abort() {
    this.sync.removeListener('synchronized', this.onSyncOver);
    this.sync.removeListener('failed', this.onSyncOver);
    this.networkMngr.removeListener('installed', this.onPeerInstalled);
    this.networkMngr.removeListener('removed', this.onPeerRemoved);
    this.taskQueue.abort();
    this.processQueue.abort();
    await this.aborter.abort();
    await Promise.all(Array.from(this.engines.values()).map((engine) => engine.abort()));
    await this.networkMngr.abort();
    await this.bloomBitsIndexer.abort();
    await this.txPool.abort();
    await this.taskLoopPromise;
    await this.processLoopPromise;
    await this.chaindb.close();
    await this.evidencedb.clear();
    await this.nodedb.close();
    await this.networkdb.close();
  }
}
