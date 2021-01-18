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
import VM from '@gxchain2/vm';
import { TransactionPool } from '@gxchain2/tx-pool';
import { Block } from '@gxchain2/block';
import { Transaction } from '@gxchain2/tx';
import { hexStringToBuffer } from '@gxchain2/utils';

import { FullSynchronizer, Synchronizer } from './sync';

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
  public readonly txPool: TransactionPool;

  public db!: Database;
  public common!: Common;
  public stateManager!: StateManager;
  public peerpool!: PeerPool;
  public blockchain!: Blockchain;
  public vm!: VM;
  public sync!: Synchronizer;

  private options: NodeOptions;
  private initPromise: Promise<void>;

  constructor(options: NodeOptions) {
    this.options = options;
    this.rawdb = createLevelDB(path.join(this.options.databasePath, 'chaindb'));
    this.txPool = new TransactionPool();
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

  async setupAccountInfo(accountInfo: {
    [index: string]: {
      nonce: string;
      balance: string;
      storage: {
        [index: string]: string;
      };
      code: string;
    };
  }) {
    const stateManager = this.stateManager;
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
    this.stateManager = new StateManager({ common: this.common, trie: new Trie(this.rawdb) });
    // TODO: save the peer id.
    this.peerpool = new PeerPool({
      nodes: await Promise.all(
        [
          new Libp2pNode({
            node: this,
            peerId: await PeerId.create({ bits: 1024, keyType: 'Ed25519' }),
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

    let genesisBlock!: Block;
    try {
      const genesisHash = await this.db.numberToHash(new BN(0));
      genesisBlock = await this.db.getBlock(genesisHash);
      this.stateManager._trie.root = genesisBlock.header.stateRoot;
      console.log('find genesis block in db', '0x' + genesisHash.toString('hex'));
    } catch (error) {
      if (error.type !== 'NotFoundError') {
        throw error;
      }
    }

    if (!genesisBlock) {
      genesisBlock = Block.genesis({ header: genesisJSON.genesisInfo.genesis }, { common: this.common });
      console.log('read genesis block from file', '0x' + genesisBlock.hash().toString('hex'));

      const root = await this.setupAccountInfo(genesisJSON.accountInfo);
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
      validateBlocks: false,
      genesisBlock
    });
    this.vm = new VM({
      common: this.common,
      stateManager: this.stateManager,
      blockchain: this.blockchain
    });
    this.sync = new FullSynchronizer({ node: this });
    this.sync
      .on('error', (err) => {
        console.error('Sync error:', err);
      })
      .on('synchronized', async () => {
        for (const peer of this.peerpool.peers) {
          peer.newBlock(this.blockchain.latestBlock);
        }
      });

    await this.blockchain.init();
    await this.vm.init();
    this.sync.start();

    if (this.options.mine) {
      this.mineLoop({
        coinbase: this.options.mine.coinbase,
        mineInterval: this.options.mine.mineInterval,
        gasLimit: new BN(this.options.mine.gasLimit)
      });
    }
  }

  async processBlock(blockSkeleton: Block) {
    console.debug('process block:', blockSkeleton.header.number.toString());
    const lastHeader = await this.db.getHeader(blockSkeleton.header.parentHash, blockSkeleton.header.number.subn(1));
    const opts = {
      block: blockSkeleton,
      root: lastHeader.stateRoot,
      generate: !!blockSkeleton.header.stateRoot,
      skipBlockValidation: true
    };
    const { result, block } = await this.vm.runBlock(opts);
    blockSkeleton = block || blockSkeleton;
    await this.blockchain.putBlock(blockSkeleton);
    await this.db.batch([DBSaveReceipts(result.receipts, blockSkeleton.hash(), blockSkeleton.header.number)]);
  }

  async processBlocks(blocks: Block[]) {
    for (const block of blocks) {
      await this.processBlock(block);
    }
  }

  private async mineLoop({ coinbase, mineInterval, gasLimit }: { coinbase: string; mineInterval: number; gasLimit: BN }) {
    while (true) {
      await new Promise((r) => setTimeout(r, mineInterval));
      const transactions = this.txPool.get(100, gasLimit);
      const lastestHeader = this.blockchain.latestBlock.header;
      const block = Block.fromBlockData(
        {
          header: {
            coinbase,
            difficulty: '0x1',
            gasLimit,
            nonce: '0x0102030405060708',
            number: lastestHeader.number.addn(1),
            parentHash: lastestHeader.hash(),
            uncleHash: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
            transactionsTrie: await Transaction.calculateTransactionTrie(transactions)
          },
          transactions
        },
        { common: this.common }
      );
      await this.processBlock(block);
    }
  }
}
