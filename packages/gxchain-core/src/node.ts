import { DatabaseImpl } from '@gxchain2/database';
import { P2PImpl } from '@gxchain2/network';
import { Node, P2P, Database } from '@gxchain2/interface';
import { CommonImpl } from '@gxchain2/common';

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
