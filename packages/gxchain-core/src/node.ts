import path from 'path';
import fs from 'fs';

import type { LevelUp } from 'levelup';
import BN from 'bn.js';
import { Block } from '@ethereumjs/block';
import type { RunBlockResult } from '@ethereumjs/vm/dist/runBlock';
import { Account, Address, setLengthLeft, rlp, toBuffer } from 'ethereumjs-util';
import { SecureTrie as Trie } from 'merkle-patricia-tree';

import { Node, P2P, Database } from '@gxchain2/interface';
import { DatabaseImpl, createLevelDB } from '@gxchain2/database';
import { P2PImpl } from '@gxchain2/network';
import { CommonImpl } from '@gxchain2/common';
import { BlockchainImpl } from '@gxchain2/blockchain';
import { StateManagerImpl } from '@gxchain2/state-manager';
import { VMImpl } from '@gxchain2/vm';
import { TransactionPool } from '@gxchain2/tx-pool';

function createReceipt(tx, block, logs, gasUsed, cumulativeGasUsed, contractAddress, status, logsBloom) {
  var obj: any = {};
  obj.tx = tx;
  obj.block = block;
  obj.logs = logs;
  obj.gasUsed = gasUsed;
  obj.cumulativeGasUsed = cumulativeGasUsed;
  obj.contractAddress = contractAddress;
  obj.status = status;
  obj.logsBloom = logsBloom;

  obj.transactionIndex = 0;

  obj.txHash = tx.hash();

  for (var i = 0; i < block.transactions.length; i++) {
    var current = block.transactions[i];
    if (current.hash().equals(obj.txHash)) {
      obj.transactionIndex = i;
      break;
    }
  }
  return obj;
}

/*
class Receipt {
  tx;
  block;
  logs;
  gasUsed;
  cumulativeGasUsed;
  contractAddress;
  status;
  logsBloom;

  transactionIndex;

  txHash;
  constructor() {}
}
*/

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
    this.stateManager = new StateManagerImpl({ common: this.common, trie: new Trie(this.accountDB /*, Buffer.from('e132066795abcca2e7c94f37db52bb376ba9e1bf25b73564f3207155a65d88c7', 'hex')*/) });
    this.txPool = new TransactionPool();
  }

  async setupAccountInfo(accountInfo: any) {
    const stateManager = this.stateManager;
    console.log('before: 0x' + (await stateManager.getStateRoot()).toString('hex'));
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
    console.log('after: 0x' + (await stateManager.getStateRoot()).toString('hex'));
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
    // await this.p2p.init();
  }

  async processBlock(block: Block) {
    const last = (await this.blockchain.getHead()).header.stateRoot;
    console.log('last: 0x' + last.toString('hex'));
    const results = await this.vm.runBlock({
      block,
      root: last,
      generate: true,
      skipBlockValidation: true
    });

    block = Block.fromBlockData({ header: { ...block.header, receiptTrie: results.receiptRoot }, transactions: block.transactions }, { common: this.common });
    console.log('process block', block.toJSON());
    // Put that block on the end of the chain
    await this.blockchain.putBlock(block);
  }
}
