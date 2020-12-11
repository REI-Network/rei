import process from 'process';
import path from 'path';

import prompts from 'prompts';
import PeerId from 'peer-id';
import Multiaddr from 'multiaddr';
import uint8ArrayFromString from 'uint8arrays/from-string';
import BN from 'bn.js';
import { Transaction } from '@ethereumjs/tx';
import { Block } from '@ethereumjs/block';
import streamToIterator from 'stream-to-iterator';
import { Account, Address } from 'ethereumjs-util';

import { Node } from '../src';
import { stringToCID } from '@gxchain2/utils';
import { constants } from '@gxchain2/common';

const keyPair = {
  '0x3289621709f5b35d09b4335e129907ac367a0593': Buffer.from('d8ca4883bbf62202904e402750d593a297b5640dea80b6d5b239c5a9902662c0', 'hex'),
  '0xd1e52f6eacbb95f5f8512ff129cbd6360e549b0b': Buffer.from('db0558cc5f24dd09c390a25c7958a678e7efa0f286053da5df53dcecdba2a13c', 'hex')
};

const getPrivateKey = (address: string): Buffer => {
  return keyPair[address];
};

// tslint:disable-next-line: no-shadowed-variable
const startPrompts = async (node: Node) => {
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
      node.peerpool.nodes[0].peerStore.addressBook.set(PeerId.createFromB58String(arr[1]), [new Multiaddr(arr[2])]);
    } else if (arr[0] === 'mine' || arr[0] === 'm') {
      /*
    else if (arr[0] === 'find' || arr[0] === 'f') {
      try {
        const peer = await p2pNode.peerRouting.findPeer(PeerId.createFromB58String(arr[1]));

        console.log('Found it, multiaddrs are:');
        peer.multiaddrs.forEach((ma) => console.log(`${ma.toString()}/p2p/${peer.id.toB58String()}`));
      } catch (err) {
        console.error('\n$ Error, findPeer', err);
      }
    } else if (arr[0] === 'connect' || arr[0] === 'c') {
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
      } catch (err) {
        console.error('\n$ Error, dial', err);
      }
    } else if (arr[0] === 'lsp2p') {
      console.log('peers:');
      for (const [peerIdString] of p2pNode.peerStore.peers.entries()) {
        console.log(peerIdString);
      }
      console.log('connected peers:');
      node.p2p.forEachPeer((val, id) => {
        console.log(id);
      });
    } else if (arr[0] === 'fetch') {
      const peer = node.p2p.getPeer(arr[1]);
      if (peer) {
        try {
          const results = await peer.jsonRPCRequest('ls');
          console.log('fetch result:', results);
        } catch (err) {
          console.error('$ Error, fetch', err);
        }
      } else {
        console.warn('$ Can not find peer');
      }
    } else if (arr[0] === 'disconnect' || arr[0] === 'd') {
      const peer = node.p2p.getPeer(arr[1]);
      if (peer) {
        try {
          await peer.jsonRPCNotify('disconnect', [node.p2p.getLocalPeerId()], true);
          await new Promise((r) => setTimeout(r, 500));
          await p2pNode.hangUp(PeerId.createFromB58String(arr[1]));
        } catch (err) {
          console.error('$ Error, disconnect', err);
        }
      } else {
        console.warn('$ Can not find peer');
      }
    } else if (arr[0] === 'send' || arr[0] === 's') {
      const peer = node.p2p.getPeer(arr[1]);
      if (peer) {
        peer.jsonRPCNotify('echo', arr[2]);
      } else {
        console.warn('$ Can not find peer');
      }
    } 
    */
      try {
        const lastestHeader = (await node.blockchain.getHead()).header;
        const block = Block.fromBlockData(
          {
            header: {
              coinbase: '0x3289621709f5b35d09b4335e129907ac367a0593',
              difficulty: '0x1',
              gasLimit: '0x2fefd8',
              nonce: '0x0102030405060708',
              number: lastestHeader.number.addn(1),
              parentHash: lastestHeader.hash(),
              uncleHash: '0x0'
            },
            transactions: node.txPool.get(1, new BN(21000))
          },
          { common: node.common }
        );
        await node.processBlock(block);
      } catch (err) {
        console.error('Run block error', err);
      }
    } else if (arr[0] === 'lsblock') {
      for (let h = 0; ; h++) {
        try {
          const block = await node.blockchain.dbManager.getBlock(h);
          console.log('block on height', h, ':', block.toJSON());
        } catch (err) {
          if (err.type === 'NotFoundError') {
            break;
          }
          throw err;
        }
      }
    } else if (arr[0] === 'lsaccount') {
      const stream = node.stateManager._trie.createReadStream();
      for await (let data of streamToIterator(stream as any)) {
        console.log('key', '0x' + data.key.toString('hex'), '\nbalance', Account.fromRlpSerializedAccount(data.value).balance.toString());
      }
    } else if (arr[0] === 'puttx') {
      const acc = await node.stateManager.getAccount(Address.fromString(arr[1]));
      const unsignedTx = Transaction.fromTxData(
        {
          gasLimit: '0x5208',
          gasPrice: '0x01',
          nonce: acc.nonce,
          to: arr[2],
          value: arr[3]
        },
        { common: node.common }
      );
      node.txPool.put(unsignedTx.sign(getPrivateKey(arr[1])));
    } else {
      console.warn('$ Invalid command');
      continue;
    }
  }
};

(async () => {
  try {
    const node = new Node(path.join(__dirname, './testdb'));
    await node.init();
    await startPrompts(node);
  } catch (err) {
    console.error('Catch error', err);
  }
})();
