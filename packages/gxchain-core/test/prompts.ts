import process from 'process';

import prompts from 'prompts';
import PeerId from 'peer-id';
import Multiaddr from 'multiaddr';
import uint8ArrayFromString from 'uint8arrays/from-string';
import BN from 'bn.js';
import { Transaction } from '@ethereumjs/tx';
import { Block } from '@ethereumjs/block';
import streamToIterator from 'stream-to-iterator';
import { Account } from 'ethereumjs-util';

import { NodeImpl } from '../src';
import { stringToCID } from '@gxchain2/utils';
import { constants } from '@gxchain2/common';

const getPrivateKey = (address: string): Buffer => {
  const keyPair = {
    '0x3289621709f5b35d09b4335e129907ac367a0593': Buffer.from('d8ca4883bbf62202904e402750d593a297b5640dea80b6d5b239c5a9902662c0', 'hex'),
    '0xd1e52f6eacbb95f5f8512ff129cbd6360e549b0b': Buffer.from('db0558cc5f24dd09c390a25c7958a678e7efa0f286053da5df53dcecdba2a13c', 'hex')
  };
  return keyPair[address];
};

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
    } else if (arr[0] === 'find' || arr[0] === 'f') {
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
    } else if (arr[0] === 'mine' || arr[0] === 'm') {
      /*
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
        blockHash: block.blockHash
      };
      node.db.updateLocalBlockHeight(block.height);
      node.db.put(block.blockHash, block);
      await p2pNode.contentRouting.provide(await stringToCID(block.blockHash));
      await p2pNode.pubsub.publish(constants.NewBlockTopic, uint8ArrayFromString(JSON.stringify(publishBlockInfo)));
      */
      try {
        const unsignedTx = Transaction.fromTxData(
          {
            gasLimit: '0x5208',
            gasPrice: '0x01',
            nonce: '0x00',
            to: '0xd1e52f6eacbb95f5f8512ff129cbd6360e549b0b',
            value: '0x01'
          },
          { common: node.common }
        );
        const block = Block.fromBlockData(
          {
            header: {
              // bloom:
              //   '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
              coinbase: '0x3289621709f5b35d09b4335e129907ac367a0593',
              // difficulty: '0x020000',
              // extraData: '0x42',
              gasLimit: '0x2fefd8',
              // gasUsed: '0x00',
              // mixHash: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
              // nonce: '0x0102030405060708',
              number: '0x01',
              parentHash: '0x7285abd5b24742f184ad676e31f6054663b3529bc35ea2fcad8a3e0f642a46f7'
              // receiptTrie: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
              // stateRoot: '0xcafd881ab193703b83816c49ff6c2bf6ba6f464a1be560c42106128c8dbc35e7',
              // timestamp: '0x54c98c81',
              // transactionsTrie: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
              // uncleHash: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347'
            },
            transactions: [unsignedTx.sign(getPrivateKey('0x3289621709f5b35d09b4335e129907ac367a0593'))]
          },
          { common: node.common }
        );
        // const result = await node.vm.runBlock({ block, generate: true, skipBlockValidation: true });
        // await node.blockchain.putBlock(block);
        await node.processBlock(block);
      } catch (err) {
        console.error('Run block error', err);
      }
    } else if (arr[0] === 'lsblock') {
      node.blockchain.iterator('vm', (block, reorg) => {
        console.log('Block:', block.toJSON(), reorg);
      });
    } else if (arr[0] === 'lsaccount') {
      const stream = node.stateManager._trie.createReadStream();
      for await (let data of streamToIterator(stream as any)) {
        console.log('key', '0x' + data.key.toString('hex'), '\nbalance', Account.fromRlpSerializedAccount(data.value).balance.toString());
      }
    } else if (arr[0] === 'vm') {
      const STOP = '00';
      const ADD = '01';
      const PUSH1 = '60';

      // Note that numbers added are hex values, so '20' would be '32' as decimal e.g.
      const code = [PUSH1, '03', PUSH1, '05', ADD, STOP];

      node.vm.on('step', function (data) {
        console.log(`Opcode: ${data.opcode.name}\tStack: ${data.stack}`);
      });

      try {
        const results = await node.vm.runCode({
          code: Buffer.from(code.join(''), 'hex'),
          gasLimit: new BN(0xffff)
        });
        console.log(`Returned: ${results.returnValue.toString('hex')}`);
        console.log(`gasUsed : ${results.gasUsed.toString()}`);
      } catch (err) {
        console.error('vm runCode error', err);
      }
    } else {
      console.warn('$ Invalid command');
      continue;
    }
  }
};

(async () => {
  try {
    const node = new NodeImpl('../../../db');
    await node.init();
    await startPrompts(node);
  } catch (err) {
    console.error('Catch error', err);
  }
})();
