import process from 'process';

import prompts from 'prompts';
import PeerId from 'peer-id';
import Multiaddr from 'multiaddr';
import uint8ArrayFromString from 'uint8arrays/from-string';

import { NodeImpl } from '../src';
import { stringToCID } from '@gxchain2/utils';
import { constants } from '@gxchain2/common';

// tslint:disable-next-line: no-shadowed-variable
const startPrompts = async (node: NodeImpl) => {
    const p2pNode = node.p2p.libp2pNode;
    while (true) {
        const response = await prompts({
            type: 'text',
            name: 'cmd',
            message: '> '
        });

        if (response.cmd === undefined) {
            process.exit(0);
        }

        const arr = (response.cmd as string).split(' ');
        if (!Array.isArray(arr)) {
            console.warn('$ Invalid command');
            continue;
        }

        if (arr[0] === 'add' || arr[0] === 'a') {
            p2pNode.peerStore.addressBook.set(PeerId.createFromB58String(arr[1]), [new Multiaddr(arr[2])]);
        }
        else if (arr[0] === 'find' || arr[0] === 'f') {
            try {
                const peer = await p2pNode.peerRouting.findPeer(PeerId.createFromB58String(arr[1]));

                console.log('Found it, multiaddrs are:');
                peer.multiaddrs.forEach((ma) => console.log(`${ma.toString()}/p2p/${peer.id.toB58String()}`));
            }
            catch (err) {
                console.error('\n$ Error, findPeer', err);
            }
        }
        else if (arr[0] === 'connect' || arr[0] === 'c') {
            const pos = arr[1].lastIndexOf('/');
            if (pos === -1) {
                console.warn('$ Invalid command');
                continue;
            }
            const id = arr[1].substr(pos + 1);
            if (id === undefined) {
                console.warn('$ Invalid command');
                continue;
            }

            try {
                await p2pNode.dial(arr[1]);
            }
            catch (err) {
                console.error('\n$ Error, dial', err);
            }
        }
        else if (arr[0] === 'ls') {
            console.log('peers:');
            for (const [peerIdString] of p2pNode.peerStore.peers.entries()) {
                console.log(peerIdString);
            }
            console.log('connected peers:');
            node.p2p.forEachPeer((val, id) => {
                console.log(id);
            });
        }
        else if (arr[0] === 'fetch') {
            const peer = node.p2p.getPeer(arr[1]);
            if (peer) {
                try {
                    const results = await peer.jsonRPCRequest('ls');
                    console.log('fetch result:', results);
                }
                catch (err) {
                    console.error('$ Error, fetch', err);
                }
            }
            else {
                console.warn('$ Can not find peer');
            }
        }
        else if (arr[0] === 'disconnect' || arr[0] === 'd') {
            const peer = node.p2p.getPeer(arr[1]);
            if (peer) {
                try {
                    await peer.jsonRPCNotify('disconnect', [node.p2p.getLocalPeerId()], true);
                    await new Promise(r => setTimeout(r, 500));
                    await p2pNode.hangUp(PeerId.createFromB58String(arr[1]));
                }
                catch (err) {
                    console.error('$ Error, disconnect', err);
                }
            }
            else {
                console.warn('$ Can not find peer');
            }
        }
        else if (arr[0] === 'send' || arr[0] === 's') {
            const peer = node.p2p.getPeer(arr[1]);
            if (peer) {
                peer.jsonRPCNotify('echo', arr[2]);
            }
            else {
                console.warn('$ Can not find peer');
            }
        }
        else if (arr[0] === 'mine' || arr[0] === 'm') {
            const block = {
                height: Number(arr[2]),
                blockHash: arr[1],
                transactions: ['tx1', 'tx2', 'tx3']
            };
            if (block.height <= node.db.getLocalBlockHeight()) {
                console.warn('$ New block must higher than local block');
                continue;
            }
            const publishBlockInfo = {
                height: block.height,
                blockHash: block.blockHash,
            };
            node.db.updateLocalBlockHeight(block.height);
            node.db.put(block.blockHash, block);
            await p2pNode.contentRouting.provide(await stringToCID(block.blockHash));
            await p2pNode.pubsub.publish(constants.NewBlockTopic, uint8ArrayFromString(JSON.stringify(publishBlockInfo)));
        }
        else if (arr[0] === 'lsblock') {
            console.log('localBlockHeight', node.db.getLocalBlockHeight());
            node.db.forEach((block) => console.log(block));
        }
        else {
            console.warn('$ Invalid command');
            continue;
        }
    }
};

const node = new NodeImpl();
node.init().then(() => {
    startPrompts(node);
}).catch(err => {
    console.error('Node init error', err);
});