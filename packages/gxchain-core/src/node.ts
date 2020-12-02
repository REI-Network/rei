import path from 'path';
import fs from 'fs';

import type { LevelUp } from 'levelup';
import BN from 'bn.js';
import { Block } from '@ethereumjs/block';
import { Account, Address, setLengthLeft } from 'ethereumjs-util';
import { SecureTrie as Trie } from 'merkle-patricia-tree';

import { Node, P2P, Database } from '@gxchain2/interface';
import { DatabaseImpl, createLevelDB } from '@gxchain2/database';
import { P2PImpl } from '@gxchain2/network';
import { CommonImpl } from '@gxchain2/common';
import { BlockchainImpl } from '@gxchain2/blockchain';
import { StateManagerImpl } from '@gxchain2/state-manager';
import { VMImpl } from '@gxchain2/vm';
import { TransactionPool } from '@gxchain2/tx-pool';

export default class NodeImpl implements Node {
  readonly p2p: P2P;
  readonly db: Database;
  readonly common: CommonImpl;
  readonly chainDB: LevelUp;
  readonly accountDB: LevelUp;
  readonly databasePath: string;
  readonly stateManager: StateManagerImpl;
  readonly txPool: TransactionPool;

  blockchain!: BlockchainImpl;
  vm!: VMImpl;

  constructor(databasePath: string) {
    this.databasePath = databasePath[0] === '/' ? databasePath : path.join(__dirname, databasePath);
    this.p2p = new P2PImpl(this);
    this.common = new CommonImpl({ chain: 'mainnet', hardfork: 'chainstart' });
    this.chainDB = createLevelDB(path.join(this.databasePath, 'chaindb'));
    this.accountDB = createLevelDB(path.join(this.databasePath, 'accountdb'));
    this.db = new DatabaseImpl(this.chainDB, this.common);
    this.stateManager = new StateManagerImpl({ common: this.common, trie: new Trie(this.accountDB) });
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

    BlockchainImpl.initBlockchainImpl((blockchain) => {
      blockchain.dbManager = this.db as any;
    });
    this.blockchain = new BlockchainImpl({
      db: this.chainDB,
      common: this.common,
      validateConsensus: false,
      validateBlocks: false,
      genesisBlock
    });
    this.vm = new VMImpl({
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
