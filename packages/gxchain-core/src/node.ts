import DatabaseImpl from '@gxchain2/database';
import { P2PImpl } from '@gxchain2/network';
import { handleJSONRPC, handleGossip } from '@gxchain2/rpc';
import { Node, P2P, Database } from '@gxchain2/interface';

export default class NodeImpl implements Node {
    p2p: P2P;
    db: Database;

    constructor() {
        this.p2p = new P2PImpl(handleJSONRPC.bind(undefined, this), handleGossip.bind(undefined, this));
        this.db = new DatabaseImpl();
    }

    async init() {
        await this.p2p.init();
    }
}