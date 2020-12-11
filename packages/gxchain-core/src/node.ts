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
import { Common, constants } from '@gxchain2/common';
import { Blockchain } from '@gxchain2/blockchain';
import { StateManager } from '@gxchain2/state-manager';
import { VM } from '@gxchain2/vm';
import { TransactionPool } from '@gxchain2/tx-pool';

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

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    // this.chainDB = createLevelDB(path.join(this.databasePath, 'chaindb'));
    // this.accountDB = createLevelDB(path.join(this.databasePath, 'accountdb'));
    this.txPool = new TransactionPool();
  }

  get status() {
    // TODO: impl this.
    return {
      networkId: this.common.networkId(),
      height: 100,
      bestHash: '0x123',
      genesisHash: this.common.genesis().hash
    };
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
    const genesisJSON = JSON.parse(fs.readFileSync(path.join(this.databasePath, 'genesis.json')).toString());

    this.common = new Common({
      chain: genesisJSON.genesisInfo,
      hardfork: 'chainstart'
    });
    // this.db = new Database(this.chainDB, this.common);
    // this.stateManager = new StateManager({ common: this.common, trie: new Trie(this.accountDB) });
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
      ),
      maxSize: 20
    });

    /*
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

      await this.setupAccountInfo(genesisJSON.accountInfo);
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

    await this.vm.init();
    await this.vm.runBlockchain();
    */
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
