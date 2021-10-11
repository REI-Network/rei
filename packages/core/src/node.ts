import path from 'path';
import fs from 'fs';
import type { LevelUp } from 'levelup';
import LevelStore from 'datastore-level';
import { bufferToHex, BN, BNLike, Address } from 'ethereumjs-util';
import { SecureTrie as Trie } from 'merkle-patricia-tree';
import PeerId from 'peer-id';
import { Database, createEncodingLevelDB, createLevelDB } from '@gxchain2/database';
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
import { TxFetcher } from './txsync';
import { BloomBitsIndexer, ChainIndexer } from './indexer';
import { BloomBitsFilter, BloomBitsBlocks, ConfirmsBlockNumber } from './bloombits';
import { BlockchainMonitor } from './blockchainmonitor';
import { createProtocolsByNames, NetworkProtocol, WireProtocol } from './protocols';
import { ValidatorSets } from './staking';
import { StakeManager, Router } from './contracts';
import { processBlock, ProcessBlockOpts } from './vm';
import { createEnginesByConsensusTypes, ConsensusEngine, ConsensusType } from './consensus';
import { getConsensusType } from './hardforks';

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

export interface ProcessBlockOptions extends Omit<ProcessBlockOpts, 'block'> {
  broadcast: boolean;
}

type PendingTxs = {
  txs: Transaction[];
  resolve: (results: boolean[]) => void;
};

type ProcessBlock = {
  block: Block;
  options: ProcessBlockOptions;
  resolve: (result: { block: Block; reorged: boolean }) => void;
  reject: (reason?: any) => void;
};

export class Node {
  public readonly chaindb: LevelUp;
  public readonly nodedb: LevelUp;
  public readonly networkdb: LevelStore;
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

  public readonly validatorSets: ValidatorSets = new ValidatorSets();
  public readonly engines: Map<ConsensusType, ConsensusEngine>;

  private readonly initPromise: Promise<void>;
  private readonly taskLoopPromise: Promise<void>;
  private readonly processLoopPromise: Promise<void>;
  private readonly taskQueue = new Channel<PendingTxs>();
  private readonly processQueue = new Channel<ProcessBlock>();

  private chain!: string | { chain: any; genesisState?: any };
  private networkId!: number;
  private chainId!: number;
  private genesisHash!: Buffer;

  constructor(options: NodeOptions) {
    this.chaindb = createEncodingLevelDB(path.join(options.databasePath, 'chaindb'));
    this.nodedb = createLevelDB(path.join(options.databasePath, 'nodes'));
    this.networkdb = new LevelStore(path.join(options.databasePath, 'networkdb'), { createIfMissing: true });
    const engineOptions = { node: this, enable: options.mine.enable, coinbase: options.mine.coinbase ? Address.fromString(options.mine.coinbase) : undefined };
    this.engines = createEnginesByConsensusTypes([ConsensusType.Clique, ConsensusType.Reimint], engineOptions);
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
        this.chain = JSON.parse(fs.readFileSync(path.join(options.databasePath, 'genesis.json')).toString());
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
      validateConsensus: false
    });
    await this.blockchain.init();

    this.sync = new FullSynchronizer({ node: this }).on('synchronized', this.onSyncOver).on('failed', this.onSyncOver);
    this.txPool = new TxPool({ node: this, journal: options.databasePath });

    const peerId = await this.loadPeerId(options.databasePath);
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
    this.getLastestEngine().start();
    this.getLastestEngine().newBlockHeader(this.blockchain.latestBlock.header);
  }

  private onPeerInstalled = (peer: Peer) => {
    this.sync.announce(peer);
  };

  private onPeerRemoved = (peer: Peer) => {
    this.txSync.dropPeer(peer.peerId);
  };

  private onSyncOver = () => {
    this.getLastestEngine().newBlockHeader(this.blockchain.latestBlock.header);
  };

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
    return this.engines.get(getConsensusType(common))!;
  }

  /**
   * Get lastest consensus engine
   * @returns Consensus engine
   */
  getLastestEngine() {
    return this.getEngineByCommon(this.getLatestCommon());
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
   * @returns Stake manager contract object
   */
  getStakeManager(vm: VM, block: Block) {
    const evm = new EVM(vm, new TxContext(new BN(0), Address.zero()), block);
    return new StakeManager(evm, block._common);
  }

  /**
   * Get router contract object
   * @param vm - Target vm instance
   * @param block - Target block
   * @returns Router contract object
   */
  getRouter(vm: VM, block: Block) {
    const evm = new EVM(vm, new TxContext(new BN(0), Address.zero()), block);
    return new Router(evm, block._common);
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
   * A loop that executes blocks sequentially
   */
  private async processLoop() {
    await this.initPromise;
    for await (let { block, options, resolve, reject } of this.processQueue.generator()) {
      try {
        const { reorged, block: newBlock } = await processBlock.bind(this)({ ...options, block });
        block = newBlock;

        // if canonical chain changes, notify to other modules
        if (reorged) {
          const promises = [this.txPool.newBlock(block), this.bcMonitor.newBlock(block), this.bloomBitsIndexer.newBlockHeader(block.header)];
          if (options.broadcast) {
            promises.push(this.broadcastNewBlock(block));
          }
          await Promise.all(promises);
        }

        resolve({ reorged, block });
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
          await this.getLastestEngine().addTxs(readies);
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
   * @param generate - Generate new block or not
   * @returns New block
   */
  async processBlock(block: Block, options: ProcessBlockOptions) {
    await this.initPromise;
    return new Promise<{ block: Block; reorged: boolean }>((resolve, reject) => {
      this.processQueue.push({ block, options, resolve, reject });
    });
  }

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
    await this.nodedb.close();
    await this.networkdb.close();
  }
}
