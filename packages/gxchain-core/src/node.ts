import path from 'path';
import fs from 'fs';
import type { LevelUp } from 'levelup';
import { bufferToHex, BN, BNLike } from 'ethereumjs-util';
import { SecureTrie as Trie } from 'merkle-patricia-tree';
import PeerId from 'peer-id';
import { Database, createLevelDB, DBSaveReceipts, DBSaveTxLookup } from '@gxchain2/database';
import { Libp2pNode, PeerPool } from '@gxchain2/network';
import { Common, constants, getGenesisState, getChain } from '@gxchain2/common';
import { Blockchain } from '@gxchain2/blockchain';
import { StateManager } from '@gxchain2/state-manager';
import { VM, WrappedVM } from '@gxchain2/vm';
import { TxPool } from '@gxchain2/tx-pool';
import { Block } from '@gxchain2/block';
import { TypedTransaction } from '@gxchain2/tx';
import { Channel, Aborter, logger } from '@gxchain2/utils';
import { FullSynchronizer, Synchronizer } from './sync';
import { TxFetcher } from './txsync';
import { Miner } from './miner';
import { BloomBitsIndexer, ChainIndexer } from './indexer';
import { BloomBitsFilter } from './bloombits';
import { BlockchainMonitor } from './blockchainmonitor';
import { getPrivateKey } from './fakeaccountmanager';

export interface NodeOptions {
  databasePath: string;
  chain?: string;
  mine?: {
    coinbase: string;
    gasLimit: string;
  };
  p2p?: {
    tcpPort?: number;
    wsPort?: number;
    bootnodes?: string[];
  };
}

class NewPendingTxsTask {
  txs: TypedTransaction[];
  resolve: (results: boolean[]) => void;
  constructor(txs: TypedTransaction[], resolve: (results: boolean[]) => void) {
    this.txs = txs;
    this.resolve = resolve;
  }
}
class NewBlockTask {
  block: Block;
  constructor(block: Block) {
    this.block = block;
  }
}
type Task = NewPendingTxsTask | NewBlockTask;

type ProcessBlock = {
  block: Block;
  generate: boolean;
  resolve: (block: Block) => void;
  reject: (reason?: any) => void;
};

export class Node {
  public readonly rawdb: LevelUp;
  public readonly aborter = new Aborter();

  public db!: Database;
  public peerpool!: PeerPool;
  public blockchain!: Blockchain;
  public sync!: Synchronizer;
  public txPool!: TxPool;
  public miner!: Miner;
  public txSync!: TxFetcher;
  public bloomBitsIndexer!: ChainIndexer;
  public bcMonitor!: BlockchainMonitor;

  private readonly options: NodeOptions;
  private readonly initPromise: Promise<void>;
  private readonly taskLoopPromise: Promise<void>;
  private readonly processLoopPromise: Promise<void>;
  private readonly taskQueue = new Channel<Task>();
  private readonly processQueue = new Channel<ProcessBlock>();

  private chain!: string | { chain: any; genesisState?: any };
  private networkId!: number;
  private genesisHash!: Buffer;

  constructor(options: NodeOptions) {
    this.options = options;
    this.rawdb = createLevelDB(path.join(this.options.databasePath, 'chaindb'));
    this.initPromise = this.init();
    this.taskLoopPromise = this.taskLoop();
    this.processLoopPromise = this.processLoop();
  }

  /**
   * Get the status of the node syncing
   */
  get status() {
    return {
      networkId: this.networkId,
      totalDifficulty: this.blockchain.totalDifficulty.toBuffer(),
      height: this.blockchain.latestHeight,
      bestHash: this.blockchain.latestBlock.hash(),
      genesisHash: this.genesisHash
    };
  }

  /**
   * Initialize the node
   * @returns
   */
  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    if (this.options.chain) {
      this.chain = this.options.chain;
    }
    if (this.chain === undefined) {
      try {
        this.chain = JSON.parse(fs.readFileSync(path.join(this.options.databasePath, 'genesis.json')).toString());
      } catch (err) {
        logger.warn('Read genesis.json faild, use default chain(gxc2-mainnet)');
        this.chain = 'gxc2-mainnet';
      }
    } else if (getChain(this.chain as string) === undefined) {
      throw new Error(`Unknow chain: ${this.chain}`);
    }

    const common = Common.createChainStartCommon(typeof this.chain === 'string' ? this.chain : this.chain.chain);
    this.db = new Database(this.rawdb, common);
    this.networkId = common.networkIdBN().toNumber();

    let genesisBlock!: Block;
    try {
      const genesisHash = await this.db.numberToHash(new BN(0));
      genesisBlock = await this.db.getBlock(genesisHash);
      logger.info('Find genesis block in db', bufferToHex(genesisHash));
    } catch (error) {
      if (error.type !== 'NotFoundError') {
        throw error;
      }
    }

    if (!genesisBlock) {
      genesisBlock = Block.genesis({ header: common.genesis() }, { common });
      logger.info('Read genesis block from file', bufferToHex(genesisBlock.hash()));
      if (typeof this.chain === 'string' || this.chain.genesisState) {
        const stateManager = new StateManager({ common, trie: new Trie(this.rawdb) });
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
      db: this.rawdb,
      database: this.db,
      common,
      genesisBlock
    });
    await this.blockchain.init();

    this.sync = new FullSynchronizer({ node: this });
    this.sync
      .on('error', (err) => {
        logger.error('Sync error:', err);
      })
      .on('synchronized', () => {
        const block = this.blockchain.latestBlock;
        this.newBlock(block);
      });

    this.txPool = new TxPool({ node: this as any, journal: this.options.databasePath });

    let peerId!: PeerId;
    try {
      const key = fs.readFileSync(path.join(this.options.databasePath, 'peer-key'));
      peerId = await PeerId.createFromPrivKey(key);
    } catch (err) {
      logger.warn('Read peer-key faild, generate a new key');
      peerId = await PeerId.create({ bits: 1024, keyType: 'Ed25519' });
      fs.writeFileSync(path.join(this.options.databasePath, 'peer-key'), peerId.privKey.bytes);
    }

    this.peerpool = new PeerPool({
      nodes: await Promise.all(
        [
          new Libp2pNode({
            node: this as any,
            peerId,
            protocols: new Set<string>([constants.GXC2_ETHWIRE]),
            tcpPort: this.options?.p2p?.tcpPort,
            wsPort: this.options?.p2p?.wsPort,
            bootnodes: this.options?.p2p?.bootnodes
          })
        ].map(
          (n) => new Promise<Libp2pNode>((resolve) => n.init().then(() => resolve(n)))
        )
      )
    });
    this.peerpool
      .on('error', (err) => {
        logger.error('Peer pool error:', err);
      })
      .on('added', (peer) => {
        const status = peer.getStatus(constants.GXC2_ETHWIRE);
        if (status && status.height !== undefined) {
          this.sync.announce(peer, status.height, new BN(status.totalDifficulty));
          peer.announceTx(this.txPool.getPooledTransactionHashes());
        }
      })
      .on('removed', (peer) => {
        this.txSync.dropPeer(peer.peerId);
      });

    this.sync.start();
    this.miner = new Miner(this, this.options.mine);
    await this.txPool.init();
    this.txSync = new TxFetcher(this);
    this.bloomBitsIndexer = BloomBitsIndexer.createBloomBitsIndexer({ node: this, sectionSize: constants.BloomBitsBlocks, confirmsBlockNumber: constants.ConfirmsBlockNumber });
    await this.bloomBitsIndexer.init();
    this.bcMonitor = new BlockchainMonitor(this);
    await this.bcMonitor.init();
  }

  getCommon(num: BNLike) {
    return Common.createCommonByBlockNumber(num, typeof this.chain === 'string' ? this.chain : this.chain.chain);
  }

  /**
   * Get data from an underlying state trie
   * @param root - The state root
   * @returns The state manager
   */
  async getStateManager(root: Buffer, num: BNLike) {
    const stateManager = new StateManager({ common: this.getCommon(num), trie: new Trie(this.rawdb) });
    await stateManager.setStateRoot(root);
    return stateManager;
  }

  /**
   * Assemble the Wrapped VM
   * @param root - The state root
   * @returns new VM
   */
  async getWrappedVM(root: Buffer, num: BNLike) {
    const stateManager = await this.getStateManager(root, num);
    return new WrappedVM(
      new VM({
        common: stateManager._common,
        stateManager,
        blockchain: this.blockchain
      })
    );
  }

  getFilter() {
    return new BloomBitsFilter({ node: this, sectionSize: constants.BloomBitsBlocks });
  }

  private async processLoop() {
    await this.initPromise;
    for await (let { block, generate, resolve, reject } of this.processQueue.generator()) {
      try {
        for (const tx of block.transactions) {
          tx.common.getHardforkByBlockNumber(block.header.number);
        }
        const lastHeader = await this.db.getHeader(block.header.parentHash, block.header.number.subn(1));
        const opts = {
          block,
          generate,
          root: lastHeader.stateRoot,
          cliqueSigner: getPrivateKey(block.header.cliqueSigner().buf.toString('hex'))
        };
        const { result, block: newBlock } = await (await this.getWrappedVM(lastHeader.stateRoot, lastHeader.number)).runBlock(opts);
        block = newBlock || block;
        logger.info('✨ Process block, height:', block.header.number.toString(), 'hash:', bufferToHex(block.hash()));
        if (block._common.param('vm', 'debugConsole')) {
          logger.debug('Node::processLoop, process on hardfork:', block._common.hardfork());
        }
        await this.blockchain.putBlock(block);
        await this.db.batch(DBSaveTxLookup(block).concat(DBSaveReceipts(result.receipts, block.hash(), block.header.number)));
        resolve(block);
      } catch (err) {
        logger.error('Node::processLoop, process block error:', err);
        reject(err);
      }
    }
  }

  private async taskLoop() {
    await this.initPromise;
    for await (const task of this.taskQueue.generator()) {
      try {
        if (task instanceof NewPendingTxsTask) {
          try {
            const { results, readies } = await this.txPool.addTxs(task.txs);
            if (readies && readies.size > 0) {
              const hashes = Array.from(readies.values())
                .reduce((a, b) => a.concat(b), [])
                .map((tx) => tx.hash());
              for (const peer of this.peerpool.peers) {
                if (peer.isSupport(constants.GXC2_ETHWIRE)) {
                  peer.announceTx(hashes);
                }
              }
              await this.miner.worker.addTxs(readies);
            }
            task.resolve(results);
          } catch (err) {
            task.resolve(new Array<boolean>(task.txs.length).fill(false));
            logger.error('Node::taskLoop, NewPendingTxsTask, catch error:', err);
          }
        } else if (task instanceof NewBlockTask) {
          const { block } = task;
          const td = await this.db.getTotalDifficulty(block.hash(), block.header.number);
          for (const peer of this.peerpool.peers) {
            if (peer.isSupport(constants.GXC2_ETHWIRE)) {
              peer.announceNewBlock(block, td);
            }
          }
          await this.txPool.newBlock(block);
          await Promise.all([this.miner.worker.newBlockHeader(block.header), this.bcMonitor.newBlock(block), this.bloomBitsIndexer.newBlockHeader(block.header)]);
        }
      } catch (err) {
        logger.error('Node::taskLoop, catch error:', err);
      }
    }
  }

  /**
   * Push a block to the queue of blocks to be processed
   * @param block - Block data
   * @param generate - Judgment criteria for root verification
   */
  async processBlock(block: Block, generate: boolean = true) {
    await this.initPromise;
    return new Promise<Block>((resolve, reject) => {
      this.processQueue.push({ block, generate, resolve, reject });
    });
  }

  /**
   * Push a new block task to the taskQueue
   * @param block - Block data
   */
  async newBlock(block: Block) {
    await this.initPromise;
    this.taskQueue.push(new NewBlockTask(block));
  }

  /**
   * Push pending transactions to the taskQueue
   * @param txs - transactions
   */
  async addPendingTxs(txs: TypedTransaction[]) {
    await this.initPromise;
    return new Promise<boolean[]>((resolve) => {
      this.taskQueue.push(new NewPendingTxsTask(txs, resolve));
    });
  }

  async abort() {
    this.taskQueue.abort();
    this.processQueue.abort();
    await this.aborter.abort();
    await this.peerpool.abort();
    await this.bloomBitsIndexer.abort();
    await this.txPool.abort();
    await this.taskLoopPromise;
    await this.processLoopPromise;
  }
}
