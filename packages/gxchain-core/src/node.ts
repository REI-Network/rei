import path from 'path';
import fs from 'fs';

import type { LevelUp } from 'levelup';
import BN from 'bn.js';
import { Account, Address, setLengthLeft } from 'ethereumjs-util';
import { SecureTrie as Trie } from 'merkle-patricia-tree';
import PeerId from 'peer-id';

import { Database, createLevelDB, DBSaveReceipts } from '@gxchain2/database';
import { Libp2pNode, PeerPool } from '@gxchain2/network';
import { Common, constants, defaultGenesis } from '@gxchain2/common';
import { Blockchain } from '@gxchain2/blockchain';
import { StateManager } from '@gxchain2/state-manager';
import { VM, WrappedVM } from '@gxchain2/vm';
import { TxPool } from '@gxchain2/tx-pool';
import { Block } from '@gxchain2/block';
import { Transaction, WrappedTransaction } from '@gxchain2/tx';
import { hexStringToBuffer, SemaphoreLock } from '@gxchain2/utils';

import { FullSynchronizer, Synchronizer } from './sync';
import { Miner } from './miner';

export interface NodeOptions {
  databasePath: string;
  mine?: {
    coinbase: string;
    mineInterval: number;
    gasLimit: string;
  };
  p2p?: {
    tcpPort?: number;
    wsPort?: number;
    bootnodes?: string[];
  };
}

export class Node {
  public readonly rawdb: LevelUp;

  public db!: Database;
  public common!: Common;
  public peerpool!: PeerPool;
  public blockchain!: Blockchain;
  public sync!: Synchronizer;
  public txPool!: TxPool;
  public miner!: Miner;

  private readonly options: NodeOptions;
  private readonly initPromise: Promise<void>;
  private readonly pendingLock = new SemaphoreLock<BN>((a, b) => {
    if (a.lt(b)) {
      return -1;
    }
    if (a.gt(b)) {
      return 1;
    }
    return 0;
  });

  constructor(options: NodeOptions) {
    this.options = options;
    this.rawdb = createLevelDB(path.join(this.options.databasePath, 'chaindb'));
    this.initPromise = this.init();
  }

  get status() {
    return {
      networkId: this.common.networkId(),
      height: this.blockchain.latestHeight,
      bestHash: this.blockchain.latestHash,
      genesisHash: this.common.genesis().hash
    };
  }

  private async setupAccountInfo(
    accountInfo: {
      [index: string]: {
        nonce: string;
        balance: string;
        storage: {
          [index: string]: string;
        };
        code: string;
      };
    },
    stateManager: StateManager
  ) {
    await stateManager.checkpoint();
    for (const addr of Object.keys(accountInfo)) {
      const { nonce, balance, storage, code } = accountInfo[addr];
      const address = new Address(Buffer.from(addr.slice(2), 'hex'));
      const account = Account.fromAccountData({ nonce, balance });
      await stateManager.putAccount(address, account);
      for (const hexStorageKey of Object.keys(storage)) {
        const val = Buffer.from(storage[hexStorageKey], 'hex');
        const storageKey = setLengthLeft(Buffer.from(hexStorageKey, 'hex'), 32);
        await stateManager.putContractStorage(address, storageKey, val);
      }
      const codeBuf = Buffer.from(code.slice(2), 'hex');
      await stateManager.putContractCode(address, codeBuf);
    }
    await stateManager.commit();
    return stateManager._trie.root;
  }

  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    let genesisJSON;
    try {
      genesisJSON = JSON.parse(fs.readFileSync(path.join(this.options.databasePath, 'genesis.json')).toString());
    } catch (err) {
      console.error('Read genesis.json faild, use default genesis');
      genesisJSON = defaultGenesis;
    }

    const poa: Buffer[] = [];
    if (genesisJSON.POA && Array.isArray(genesisJSON.POA)) {
      for (const address of genesisJSON.POA) {
        if (typeof address === 'string') {
          poa.push(hexStringToBuffer(address));
        }
      }
    }

    this.common = new Common(
      {
        chain: genesisJSON.genesisInfo,
        hardfork: 'chainstart'
      },
      poa
    );
    this.db = new Database(this.rawdb, this.common);

    let genesisBlock!: Block;
    try {
      const genesisHash = await this.db.numberToHash(new BN(0));
      genesisBlock = await this.db.getBlock(genesisHash);
      console.log('find genesis block in db', '0x' + genesisHash.toString('hex'));
    } catch (error) {
      if (error.type !== 'NotFoundError') {
        throw error;
      }
    }

    if (!genesisBlock) {
      genesisBlock = Block.genesis({ header: genesisJSON.genesisInfo.genesis }, { common: this.common });
      console.log('read genesis block from file', '0x' + genesisBlock.hash().toString('hex'));

      const stateManager = new StateManager({ common: this.common, trie: new Trie(this.rawdb) });
      const root = await this.setupAccountInfo(genesisJSON.accountInfo, stateManager);
      if (!root.equals(genesisBlock.header.stateRoot)) {
        console.error('state root not equal', '0x' + root.toString('hex'), '0x' + genesisBlock.header.stateRoot.toString('hex'));
        throw new Error('state root not equal');
      }
    }

    this.blockchain = new Blockchain({
      db: this.rawdb,
      database: this.db,
      common: this.common,
      validateConsensus: false,
      validateBlocks: true,
      genesisBlock
    });
    await this.blockchain.init();

    this.sync = new FullSynchronizer({ node: this });
    this.sync
      .on('error', (err) => {
        console.error('Sync error:', err);
      })
      .on('synchronized', () => {
        const block = this.blockchain.latestBlock;
        this.newBlock(block);
      });

    this.txPool = new TxPool({ node: this });
    await this.txPool.init();

    let peerId!: PeerId;
    try {
      const key = fs.readFileSync(path.join(this.options.databasePath, 'peer-key'));
      peerId = await PeerId.createFromPrivKey(key);
    } catch (err) {
      console.error('Read peer-key faild, generate new key');
      peerId = await PeerId.create({ bits: 1024, keyType: 'Ed25519' });
      fs.writeFileSync(path.join(this.options.databasePath, 'peer-key'), peerId.privKey.bytes);
    }

    this.peerpool = new PeerPool({
      nodes: await Promise.all(
        [
          new Libp2pNode({
            node: this,
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
        console.error('Peer pool error:', err);
      })
      .on('added', (peer) => {
        const status = peer.getStatus(constants.GXC2_ETHWIRE);
        if (status && status.height) {
          this.sync.announce(peer, status.height);
        }
      });

    this.sync.start();
    this.miner = new Miner(this, this.options.mine);
  }

  async getStateManager(root: Buffer) {
    const stateManager = new StateManager({ common: this.common, trie: new Trie(this.rawdb) });
    await stateManager.setStateRoot(root);
    return stateManager;
  }

  async getWrappedVM(root: Buffer) {
    const stateManager = await this.getStateManager(root);
    return new WrappedVM(
      new VM({
        common: this.common,
        stateManager,
        blockchain: this.blockchain
      })
    );
  }

  async processBlock(blockSkeleton: Block, generate: boolean = true) {
    await this.initPromise;
    console.debug('process block:', blockSkeleton.header.number.toString());
    const lastHeader = await this.db.getHeader(blockSkeleton.header.parentHash, blockSkeleton.header.number.subn(1));
    const opts = {
      block: blockSkeleton,
      root: lastHeader.stateRoot,
      generate
    };
    const { result, block } = await (await this.getWrappedVM(lastHeader.stateRoot)).runBlock(opts);
    blockSkeleton = block || blockSkeleton;
    await this.blockchain.putBlock(blockSkeleton);
    await this.blockchain.saveTxLookup(blockSkeleton);
    await this.db.batch([DBSaveReceipts(result.receipts, blockSkeleton.hash(), blockSkeleton.header.number)]);
    return blockSkeleton;
  }

  async processBlocks(blocks: Block[]) {
    for (const block of blocks) {
      await this.processBlock(block);
    }
  }

  async newBlock(block: Block) {
    await this.initPromise;
    if (!(await this.pendingLock.compareLock(block.header.number))) {
      return;
    }
    try {
      for (const peer of this.peerpool.peers) {
        if (peer.isSupport(constants.GXC2_ETHWIRE)) {
          peer.newBlock(block);
        }
      }
      await this.txPool.newBlock(block);
      await this.miner.worker.newBlock(block);
      this.pendingLock.release();
    } catch (err) {
      console.error('Node new block error:', err);
      this.pendingLock.release();
    }
  }

  async addPendingTxs(txs: Transaction[]) {
    await this.initPromise;
    await this.pendingLock.lock();
    try {
      const readies = await this.txPool.addTxs(txs.map((tx) => new WrappedTransaction(tx)));
      if (readies && readies.size > 0) {
        await this.miner.worker.addTxs(readies);
      }
      this.pendingLock.release();
    } catch (err) {
      console.error('Node add txs error:', err);
      this.pendingLock.release();
    }
  }
}
