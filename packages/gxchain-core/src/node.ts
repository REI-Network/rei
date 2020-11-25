import { Node, P2P, Database } from '@gxchain2/interface';
import { DatabaseImpl, levelDB } from '@gxchain2/database';
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

  constructor() {
    this.p2p = new P2PImpl(this);
    this.common = new CommonImpl({ chain: 'mainnet' });
    this.db = new DatabaseImpl(levelDB, this.common);
    BlockchainImpl.initBlockchainImpl((blockchain) => {
      blockchain.dbManager = this.db as any;
    });
    this.blockchain = new BlockchainImpl({
      db: levelDB,
      common: this.common
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
  }
}
