import uint8ArrayToString from 'uint8arrays/to-string';

import { Node } from '@gxchain2/interface';
import { stringToCID } from '@gxchain2/utils';
import { constants } from '@gxchain2/common';

const handleGossip = async (node: Node, topic: string, msg: { data: Uint8Array }): Promise<void> => {
    console.log('\n$ Receive gossip, topic', topic);
    switch (topic) {
        case constants.NewBlockTopic:
            try {
                const publishBlockInfo = JSON.parse(uint8ArrayToString(msg.data));
                if (publishBlockInfo.height <= node.db.getLocalBlockHeight()) {
                    console.warn('\n$ Gossip receive block height', publishBlockInfo.height, ', but less or equal than local block height', node.db.getLocalBlockHeight());
                    return;
                }
                for await (const provider of node.p2p.node.contentRouting.findProviders(await stringToCID(publishBlockInfo.blockHash), { timeout: 3e3, maxNumProviders: 3 })) {
                    const id = provider.id._idB58String;
                    const peer = node.p2p.getPeer(id);
                    if (peer) {
                        const block = await peer.jsonRPCRequest('getBlockByHash', [publishBlockInfo.blockHash]);
                        console.log('\n$ Get block from', id, block);
                        if (block.height > node.db.getLocalBlockHeight()) {
                            node.db.updateLocalBlockHeight(block.height);
                            node.db.put(block.blockHash, block);
                        }
                        return;
                    }
                }
            }
            catch (err) {
                console.error('\n$ Error, handle gossip msg', topic, err);
            }
            break;
        default:
            console.log('\n$ Receive unkonw gossip:', topic, msg);
    }
};

export default handleGossip;