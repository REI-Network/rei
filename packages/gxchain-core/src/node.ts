import path from 'path';
import fs from 'fs';

import type { LevelUp } from 'levelup';
import BN from 'bn.js';
import { Block } from '@ethereumjs/block';
import { Account, Address, setLengthLeft } from 'ethereumjs-util';
import { SecureTrie as Trie } from 'merkle-patricia-tree';
import PeerId from 'peer-id';

import { INode } from '@gxchain2/interface';
import { Database, createLevelDB } from '@gxchain2/database';
import { Libp2pNode, PeerPool } from '@gxchain2/network';
import { Common, constants, defaultGenesis } from '@gxchain2/common';
import { Blockchain } from '@gxchain2/blockchain';
import { StateManager } from '@gxchain2/state-manager';
import { VM } from '@gxchain2/vm';
import { TransactionPool } from '@gxchain2/tx-pool';

import { FullSynchronizer, Synchronizer } from './sync';

export class Node implements INode {
  public readonly chainDB!: LevelUp;
  public readonly accountDB!: LevelUp;
  public readonly databasePath: string;
  public readonly txPool: TransactionPool;

  public db!: Database;
  public common!: Common;
  public stateManager!: StateManager;
  public peerpool!: PeerPool;
  public blockchain!: Blockchain;
  public vm!: VM;
  public sync!: Synchronizer;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    this.chainDB = createLevelDB(path.join(this.databasePath, 'chaindb'));
    this.accountDB = createLevelDB(path.join(this.databasePath, 'accountdb'));
    this.txPool = new TransactionPool();
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
    let genesisJSON;
    try {
      genesisJSON = JSON.parse(fs.readFileSync(path.join(this.databasePath, 'genesis.json')).toString());
    } catch (err) {
      console.error('Read genesis.json faild, use default genesis');
      genesisJSON = defaultGenesis;
    }

    this.common = new Common({
      chain: genesisJSON.genesisInfo,
      hardfork: 'chainstart'
    });
    this.db = new Database(this.chainDB, this.common);
    this.stateManager = new StateManager({ common: this.common, trie: new Trie(this.accountDB) });
    // TODO: save the peer id.
    this.peerpool = new PeerPool({
      nodes: await Promise.all(
        [
          new Libp2pNode({
            node: this,
            peerId: await PeerId.create({ bits: 1024, keyType: 'Ed25519' }),
            protocols: new Set<string>([constants.GXC2_ETHWIRE])
          })
        ].map(
          (n) => new Promise<Libp2pNode>((resolve) => n.init().then(() => resolve(n)))
        )
      )
    });
    this.peerpool.on('message', async ({ name, data }, protocol, peer) => {
      try {
        switch (name) {
          case 'GetBlockHeaders':
            const { start, count } = data;
            const blocks = await this.blockchain.getBlocks(start, count, 0, false);
            peer.send(
              protocol.name,
              'BlockHeaders',
              blocks.map((b) => b.header)
            );
            break;
          default:
            throw new Error(`unkonw method name, ${name}`);
        }
      } catch (err) {
        console.error('Node handle message error:', err);
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
      db: this.chainDB,
      common: this.common,
      validateConsensus: false,
      validateBlocks: false,
      genesisBlock
    });
    this.blockchain.dbManager = this.db;
    this.vm = new VM({
      common: this.common,
      stateManager: this.stateManager,
      blockchain: this.blockchain
    });
    this.sync = new FullSynchronizer({ node: this });
    this.sync.on('error', (err) => {
      console.error('Sync error:', err);
    });

    await this.blockchain.init();
    await this.vm.init();
    await this.vm.runBlockchain();
    this.sync.start();
  }

  async processBlock(block: Block) {
    const last = (await this.blockchain.getHead()).header.stateRoot;

    const opts = {
      block,
      root: last,
      generate: true,
      skipBlockValidation: true
    };
    const results = await this.vm.runBlock(opts);

    block = opts.block;
    block = Block.fromBlockData({ header: { ...block.header, receiptTrie: results.receiptRoot }, transactions: block.transactions }, { common: this.common });

    await this.blockchain.putBlock(block);
  }

  async processBlocks(blocks: Block[]) {
    for (const block of blocks) {
      console.debug('process block:', block.header.number.toString());
      await this.processBlock(block);
    }
  }
}
