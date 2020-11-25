import { Node, P2P, Database } from '@gxchain2/interface';
import { DatabaseImpl } from '@gxchain2/database';
import { P2PImpl } from '@gxchain2/network';
import { CommonImpl } from '@gxchain2/common';
import { BlockchainImpl } from '@gxchain2/blockchain';
import { VMImpl } from '@gxchain2/vm';
import { StateManagerImpl } from '@gxchain2/state-manager';

export default class NodeImpl implements Node {
  p2p: P2P;
  db: Database;

  constructor() {
    this.p2p = new P2PImpl(this);
    this.db = new DatabaseImpl(undefined as any, undefined as any);
  }

  async init() {
    await this.p2p.init();
  }
}
