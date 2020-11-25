import uint8ArrayToString from 'uint8arrays/to-string';
import PeerId from 'peer-id';

import { Node, Peer } from '@gxchain2/interface';
import { stringToCID } from '@gxchain2/utils';
import { constants } from '@gxchain2/common';

const handleGossip = async (node: Node, topic: string, msg: { data: Uint8Array }): Promise<void> => {
  console.log('\n$ Receive gossip, topic', topic);
  switch (topic) {
    case constants.NewBlockTopic:
      try {
        /*
        const publishBlockInfo = JSON.parse(uint8ArrayToString(msg.data));
        if (publishBlockInfo.height <= node.db.getLocalBlockHeight()) {
          console.warn('\n$ Gossip receive block height', publishBlockInfo.height, ', but less or equal than local block height', node.db.getLocalBlockHeight());
          return;
        }
        for await (const provider of node.p2p.libp2pNode.contentRouting.findProviders(await stringToCID(publishBlockInfo.blockHash), { timeout: 3e3, maxNumProviders: 3 })) {
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
        */
      } catch (err) {
        console.error('\n$ Error, handle gossip msg', topic, err);
      }
      break;
    default:
      console.log('\n$ Receive unkonw gossip:', topic, msg);
  }
};

const handleJSONRPC = (node: Node, peer: Peer, method: string, params?: any): Promise<any> | any => {
  console.log('\n$ Receive jsonrpc request, method', method);
  switch (method) {
    case 'echo':
      console.log('\n$ Receive echo message:', params);
      break;
    case 'ls':
      const arr: any[] = [];
      for (const [peerIdString] of node.p2p.libp2pNode.peerStore.peers.entries()) {
        arr.push(peerIdString);
      }
      return arr;
    case 'disconnect':
      if (!params) {
        console.warn('\n$ Invalid request', params);
        return;
      }
      const id = params[0];
      node.p2p.libp2pNode.hangUp(PeerId.createFromB58String(id)).catch((err) => console.error('\n$ Error, hangUp', err));
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

export { handleGossip, handleJSONRPC };
