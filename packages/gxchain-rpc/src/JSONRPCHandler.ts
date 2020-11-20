import PeerId from 'peer-id';

import { Node, Peer } from '@gxchain2/interface';

const handleJSONRPC = (node: Node, peer: Peer, method: string, params?: any): Promise<any> | any => {
    console.log('\n$ Receive jsonrpc request, method', method);
    switch (method) {
        case 'echo':
            console.log('\n$ Receive echo message:', params);
            break;
        case 'ls':
            const arr: any[] = [];
            for (const [peerIdString] of node.p2p.node.peerStore.peers.entries()) {
                arr.push(peerIdString);
            }
            return arr;
        case 'disconnect':
            if (!params) {
                console.warn('\n$ Invalid request', params);
                return;
            }
            const id = params[0];
            node.p2p.node.hangUp(PeerId.createFromB58String(id)).catch(err => console.error('\n$ Error, hangUp', err));
            break;
        case 'getBlockByHash':
            if (!params) {
                console.warn('\n$ Invalid request', params);
                return;
            }
            const hash = params[0];
            const result = node.db.get(hash);
            return result;
        default:
            console.log('\n$ Receive unkonw message:', method, params);
    }
};

export default handleJSONRPC;