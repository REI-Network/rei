import path from 'path';
import fs from 'fs';

import type { LevelUp } from 'levelup';
import BN from 'bn.js';
import { Block } from '@ethereumjs/block';

import { Node, P2P, Database } from '@gxchain2/interface';
import { DatabaseImpl, createLevelDB } from '@gxchain2/database';
import { P2PImpl } from '@gxchain2/network';
import { CommonImpl } from '@gxchain2/common';
import { BlockchainImpl } from '@gxchain2/blockchain';
import { StateManagerImpl } from '@gxchain2/state-manager';
import { VMImpl } from '@gxchain2/vm';

export default class NodeImpl implements Node {
  readonly p2p: P2P;
  readonly db: Database;
  readonly common: CommonImpl;
  readonly levelDB: LevelUp;
  readonly databasePath: string;

  blockchain!: BlockchainImpl;
  stateManager!: StateManagerImpl;
  vm!: VMImpl;

  constructor(databasePath: string) {
    this.databasePath = databasePath[0] === '/' ? databasePath : path.join(__dirname, databasePath);
    this.p2p = new P2PImpl(this);
    this.common = new CommonImpl({ chain: 'mainnet', hardfork: 'chainstart' });
    this.levelDB = createLevelDB(path.join(this.databasePath, 'chaindb'));
    this.db = new DatabaseImpl(this.levelDB, this.common);
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
      console.log('read genesis block from file', genesisBlockJSON.hash);
      genesisBlock = Block.genesis({ header: genesisBlockJSON }, { common: this.common });
    }

    BlockchainImpl.initBlockchainImpl((blockchain) => {
      blockchain.dbManager = this.db as any;
    });
    this.blockchain = new BlockchainImpl({
      db: this.levelDB,
      common: this.common,
      validateConsensus: false,
      validateBlocks: false,
      genesisBlock
    });
    this.stateManager = new StateManagerImpl({ common: this.common });
    this.vm = new VMImpl({
      common: this.common,
      stateManager: this.stateManager,
      blockchain: this.blockchain
    });

    await this.vm.init();
    await this.p2p.init();
  }
}
