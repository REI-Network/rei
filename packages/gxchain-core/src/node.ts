import path from 'path';
import fs from 'fs';

import type { LevelUp } from 'levelup';
import BN from 'bn.js';
import { Block } from '@ethereumjs/block';
import { Account, Address, setLengthLeft } from 'ethereumjs-util';
import { SecureTrie as Trie } from 'merkle-patricia-tree';

import { INode } from '@gxchain2/interface';
import { Database, createLevelDB } from '@gxchain2/database';
import { Libp2pNode } from '@gxchain2/network';
import { Common } from '@gxchain2/common';
import { Blockchain } from '@gxchain2/blockchain';
import { StateManager } from '@gxchain2/state-manager';
import { VM } from '@gxchain2/vm';
import { TransactionPool } from '@gxchain2/tx-pool';

export class Node implements INode {
  readonly db: Database;
  readonly common: Common;
  readonly chainDB: LevelUp;
  readonly accountDB: LevelUp;
  readonly databasePath: string;
  readonly stateManager: StateManager;
  readonly txPool: TransactionPool;

  p2p!: Libp2pNode;
  blockchain!: Blockchain;
  vm!: VM;

  constructor(databasePath: string) {
    this.databasePath = databasePath[0] === '/' ? databasePath : path.join(__dirname, databasePath);
    this.common = new Common({ chain: 'mainnet', hardfork: 'chainstart' });
    this.chainDB = createLevelDB(path.join(this.databasePath, 'chaindb'));
    this.accountDB = createLevelDB(path.join(this.databasePath, 'accountdb'));
    this.db = new Database(this.chainDB, this.common);
    this.stateManager = new StateManager({ common: this.common, trie: new Trie(this.accountDB) });
    this.txPool = new TransactionPool();
  }

  async setupAccountInfo(accountInfo: any) {
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
  }

  async init() {
    this.p2p = new Libp2pNode(undefined as any, undefined as any);

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
      let genesisBlockJSON = JSON.parse(fs.readFileSync(path.join(this.databasePath, 'genesisBlock.json')).toString());
      genesisBlock = Block.genesis({ header: genesisBlockJSON }, { common: this.common });
      console.log('read genesis block from file', '0x' + genesisBlock.hash().toString('hex'));

      await this.setupAccountInfo(JSON.parse(fs.readFileSync(path.join(this.databasePath, 'genesisAccount.json')).toString()));
    }

    Blockchain.initBlockchainImpl((blockchain) => {
      blockchain.dbManager = this.db as any;
    });
    this.blockchain = new Blockchain({
      db: this.chainDB,
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

    await this.vm.init();
    await this.vm.runBlockchain();
    await this.p2p.init();
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
}
