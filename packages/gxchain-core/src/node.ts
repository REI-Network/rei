import path from 'path';
import fs from 'fs';

import type { LevelUp } from 'levelup';

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
  readonly blockchain: BlockchainImpl;
  readonly common: CommonImpl;
  readonly stateManager: StateManagerImpl;
  readonly vm: VMImpl;
  readonly levelDB: LevelUp;

  constructor(databasePath: string) {
    databasePath = databasePath[0] === '/' ? databasePath : path.join(__dirname, databasePath);
    this.p2p = new P2PImpl(this);
    this.common = new CommonImpl({ chain: 'mainnet' });
    this.levelDB = createLevelDB(path.join(databasePath, 'chaindb'));
    this.db = new DatabaseImpl(this.levelDB, this.common);
    BlockchainImpl.initBlockchainImpl((blockchain) => {
      blockchain.dbManager = this.db as any;
    });
    this.blockchain = new BlockchainImpl({
      db: this.levelDB,
      common: this.common,
      validateConsensus: false,
      validateBlocks: false
    });
    this.stateManager = new StateManagerImpl({ common: this.common });
    this.vm = new VMImpl({
      common: this.common,
      stateManager: this.stateManager,
      blockchain: this.blockchain
    });
  }

  async init() {
    await this.p2p.init();
    await this.vm.init();
  }
}
