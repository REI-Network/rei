import path from 'path';
import type { LevelUp } from 'levelup';
import LevelStore from 'datastore-level';
import { bufferToHex, BN, BNLike } from 'ethereumjs-util';
import { SecureTrie as Trie } from 'merkle-patricia-tree';
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
import { WireProtocol, ConsensusProtocol } from './protocols';
import { ValidatorSets } from './staking';
import { StakeManager, Router, Contract } from './contracts';
import { ConsensusEngine, ReimintConsensusEngine, CliqueConsensusEngine, ConsensusType, ExtraData } from './consensus';
import { postByzantiumTxReceiptsToReceipts, EMPTY_ADDRESS } from './utils';
import { getConsensusTypeByCommon } from './hardforks';
import { Initializer, ProcessBlockOptions, NodeOptions, NodeStatus } from './types';

const defaultTimeoutBanTime = 60 * 5 * 1000;
const defaultInvalidBanTime = 60 * 10 * 1000;
const defaultChainName = 'gxc2-mainnet';

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

export class Node extends Initializer {
  readonly datadir: string;
  readonly chain: string;
  readonly networkId: number;
  readonly chainId: number;
  readonly genesisHash: Buffer;
  readonly chaindb: LevelUp;
  readonly nodedb: LevelUp;
  readonly evidencedb: LevelUp;
  readonly networkdb: LevelStore;
  readonly wire: WireProtocol;
  readonly consensus: ConsensusProtocol;
  readonly db: Database;
  readonly networkMngr: NetworkManager;
  readonly blockchain: Blockchain;
  readonly sync: Synchronizer;
  readonly txPool: TxPool;
  readonly txSync: TxFetcher;
  readonly bloomBitsIndexer: ChainIndexer;
  readonly bcMonitor: BlockchainMonitor;
  readonly accMngr: AccountManager;
  readonly reimint: ReimintConsensusEngine;
  readonly clique: CliqueConsensusEngine;
  readonly aborter = new Aborter();
  readonly validatorSets = new ValidatorSets();

  private taskLoopPromise!: Promise<void>;
  private processLoopPromise!: Promise<void>;
  private readonly taskQueue = new Channel<PendingTxs>();
  private readonly processQueue = new Channel<ProcessBlock>();

  constructor(options: NodeOptions) {
    super();

    this.datadir = options.databasePath;
    this.chaindb = createEncodingLevelDB(path.join(this.datadir, 'chaindb'));
    this.nodedb = createLevelDB(path.join(this.datadir, 'nodes'));
    this.evidencedb = createLevelDB(path.join(this.datadir, 'evidence'));
    this.networkdb = new LevelStore(path.join(this.datadir, 'networkdb'), { createIfMissing: true });
    this.wire = new WireProtocol(this);
    this.consensus = new ConsensusProtocol(this);
    this.accMngr = new AccountManager(options.account.keyStorePath);

    this.chain = options.chain ?? defaultChainName;
    /////// unsupport gxc2-mainnet ///////
    if (this.chain === defaultChainName) {
      throw new Error('Unspport mainnet!');
    }
    /////// unsupport gxc2-mainnet ///////
    if (getChain(this.chain) === undefined) {
      throw new Error(`Unknown chain: ${this.chain}`);
    }

    const common = this.getCommon(0);
    this.db = new Database(this.chaindb, common);
    this.networkId = common.networkIdBN().toNumber();
    this.chainId = common.chainIdBN().toNumber();
    this.clique = new CliqueConsensusEngine({ ...options.mine, node: this });
    this.reimint = new ReimintConsensusEngine({ ...options.mine, node: this });

    const genesisBlock = Block.fromBlockData({ header: common.genesis() }, { common });
    this.genesisHash = genesisBlock.hash();
    logger.info('Read genesis block from file', bufferToHex(this.genesisHash));
    this.blockchain = new Blockchain({
      dbManager: this.db,
      common,
      genesisBlock,
      validateBlocks: false,
      validateConsensus: false,
      hardforkByHeadBlockNumber: true
    });

    this.networkMngr = new NetworkManager({
      ...options.network,
      protocols: [this.wire, this.consensus],
      datastore: this.networkdb,
      nodedb: this.nodedb,
      bootnodes: [...common.bootstrapNodes(), ...(options.network.bootnodes ?? [])]
    })
      .on('installed', this.onPeerInstalled)
      .on('removed', this.onPeerRemoved);

    this.sync = new FullSynchronizer({ node: this }).on('synchronized', this.onSyncOver).on('failed', this.onSyncOver);
    this.txPool = new TxPool({ node: this, journal: this.datadir });
    this.txSync = new TxFetcher(this);
    this.bcMonitor = new BlockchainMonitor(this.db);
    this.bloomBitsIndexer = BloomBitsIndexer.createBloomBitsIndexer({ db: this.db, sectionSize: BloomBitsBlocks, confirmsBlockNumber: ConfirmsBlockNumber });
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

  private async generateGenesis(latest: Block) {
    if (latest.header.number.eqn(0)) {
      const common = this.getCommon(0);
      const genesisBlock = Block.fromBlockData({ header: common.genesis() }, { common });
      const stateManager = new StateManager({ common, trie: new Trie(this.chaindb) });
      await stateManager.generateGenesis(getGenesisState(this.chain));
      let root = await stateManager.getStateRoot();

      // if it is mainnet or devnet, deploy system contract now
      if (this.chain === 'gxc2-devnet' || this.chain === 'gxc2-mainnet') {
        const vm = await this.getVM(root, common);
        const evm = new EVM(vm, new TxContext(new BN(0), EMPTY_ADDRESS), genesisBlock);
        await Contract.deploy(evm, common);
        root = await vm.stateManager.getStateRoot();
      }

      if (!root.equals(genesisBlock.header.stateRoot)) {
        logger.error('State root not equal', bufferToHex(root), bufferToHex(genesisBlock.header.stateRoot));
        throw new Error('state root not equal');
      }
    }
  }

  /**
   * Initialize the node
   */
  async init() {
    await this.blockchain.init();
    const latest = this.blockchain.latestBlock;
    await this.generateGenesis(latest);
    await this.networkdb.open();
    await this.networkMngr.init();
    await this.txPool.init(latest);
    await this.bloomBitsIndexer.init();
    await this.bcMonitor.init(latest.header);
    this.initOver();
  }

  start() {
    this.sync.start();
    this.txPool.start();
    this.txSync.start();
    this.bloomBitsIndexer.start();
    this.networkMngr.start();

    this.taskLoopPromise = this.taskLoop();
    this.processLoopPromise = this.processLoop();

    // start mint
    this.getCurrentEngine().start();
    this.getCurrentEngine().newBlock(this.blockchain.latestBlock);
  }

  /**
   * Abort node
   */
  async abort() {
    this.sync.off('synchronized', this.onSyncOver);
    this.sync.off('failed', this.onSyncOver);
    this.networkMngr.off('installed', this.onPeerInstalled);
    this.networkMngr.off('removed', this.onPeerRemoved);
    this.taskQueue.abort();
    this.processQueue.abort();
    await this.aborter.abort();
    await this.clique.abort();
    await this.reimint.abort();
    await this.networkMngr.abort();
    await this.sync.abort();
    await this.txPool.abort();
    this.txSync.abort();
    await this.bloomBitsIndexer.abort();
    await this.taskLoopPromise;
    await this.processLoopPromise;
    await this.chaindb.close();
    await this.evidencedb.close();
    await this.nodedb.close();
    await this.networkdb.close();
  }

  private onPeerInstalled = (name: string, peer: Peer) => {
    if (name === this.wire.name) {
      this.sync.announce(peer);
    }
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
    return Common.createCommonByBlockNumber(num, this.chain);
  }

  /**
   * Get latest block common instance
   * @returns Common object
   */
  getLatestCommon() {
    return this.blockchain.latestBlock._common;
  }

  /**
   * Get consensus engine by consensus typo
   * @param type - Consensus type
   * @returns Consensus engine
   */
  getEngineByType(type: ConsensusType): ConsensusEngine {
    if (type === ConsensusType.Clique) {
      return this.clique;
    } else if (type === ConsensusType.Reimint) {
      return this.reimint;
    } else {
      throw new Error('unknown consensus type:' + type);
    }
  }

  /**
   * Get consensus engine by common instance
   * @param common - Common instance
   * @returns Consensus engine
   */
  getEngineByCommon(common: Common) {
    return this.getEngineByType(getConsensusTypeByCommon(common))!;
  }

  /**
   * Get current working consensus engine
   * @returns Consensus engine
   */
  getCurrentEngine() {
    const nextCommon = this.getCommon(this.blockchain.latestBlock.header.number.addn(1));
    return this.getEngineByType(getConsensusTypeByCommon(nextCommon))!;
  }

  /**
   * Get clique consensus engine instance
   * @returns CliqueConsensusEngine
   */
  getCliqueEngine() {
    return this.getEngineByType(ConsensusType.Clique) as CliqueConsensusEngine;
  }

  /**
   * Get reimint consensus engine instance
   * @returns ReimintConsensusEngine
   */
  getReimintEngine() {
    return this.getEngineByType(ConsensusType.Reimint) as ReimintConsensusEngine;
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
      blockchain: this.blockchain,
      getMiner: (header) => {
        const type = getConsensusTypeByCommon(header._common);
        if (type === ConsensusType.Clique) {
          return header.cliqueSigner();
        } else if (type === ConsensusType.Reimint) {
          return ExtraData.fromBlockHeader(header).proposal.proposer();
        } else {
          throw new Error('unknow consensus type');
        }
      }
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

        // get parent header from database
        const parent = await this.db.getHeader(block.header.parentHash, number.subn(1));
        // process block through consensus engine
        const { receipts: _receipts, validatorSet, extraData } = await this.getEngineByCommon(common).processBlock({ ...options, block, root: parent.stateRoot });
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

          /////////////////////////////////////
          // TODO: this shouldn't belong here
          const evpool = this.getReimintEngine()?.evpool;
          if (extraData && evpool) {
            promises.push(evpool.update(extraData.evidence, number));
          }
          /////////////////////////////////////

          if (options.broadcast) {
            promises.push(this.wire.broadcastNewBlock(block));
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
          for (const handler of this.wire.pool.handlers) {
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
}
