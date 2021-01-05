import process from 'process';
import path from 'path';
import fs from 'fs';

import prompts from 'prompts';
import PeerId from 'peer-id';
import Multiaddr from 'multiaddr';
import uint8ArrayFromString from 'uint8arrays/from-string';
import BN from 'bn.js';
import { Transaction } from '@ethereumjs/tx';
import { Block } from '@ethereumjs/block';
import streamToIterator from 'stream-to-iterator';
import { Account, Address } from 'ethereumjs-util';

import { Node } from '@gxchain2/core';
import { stringToCID } from '@gxchain2/utils';
import { constants } from '@gxchain2/common';

const args = process.argv.slice(2);

const accounts = ['0x3289621709f5b35d09b4335e129907ac367a0593', '0xd1e52f6eacbb95f5f8512ff129cbd6360e549b0b'];
const keyPair = {
  '0x3289621709f5b35d09b4335e129907ac367a0593': Buffer.from('d8ca4883bbf62202904e402750d593a297b5640dea80b6d5b239c5a9902662c0', 'hex'),
  '0xd1e52f6eacbb95f5f8512ff129cbd6360e549b0b': Buffer.from('db0558cc5f24dd09c390a25c7958a678e7efa0f286053da5df53dcecdba2a13c', 'hex')
};

const getPrivateKey = (address: string): Buffer => {
  return keyPair[address];
};

const startPrompts = async (node: Node) => {
  while (true) {
    const response = await prompts({
      type: 'text',
      name: 'cmd',
      message: '> '
    });

    if (response.cmd === undefined || response.cmd === 'exit' || response.cmd === 'q' || response.cmd === 'quit') {
      process.exit(0);
    }

    const arr = (response.cmd as string).split(' ');
    if (!Array.isArray(arr)) {
      console.warn('$ Invalid command');
      continue;
    }

    if (arr[0] === 'add' || arr[0] === 'a') {
      const pos = arr[1].indexOf('/p2p/');
      node.peerpool.nodes[0].peerStore.addressBook.set(PeerId.createFromB58String(arr[1].substr(pos + 5)), [new Multiaddr(arr[1].substr(0, pos))]);
    } else if (arr[0] === 'send' || arr[0] === 's') {
      const peer = node.peerpool.nodes[0].getPeer(arr[1]);
      if (peer) {
        peer.send(constants.GXC2_ETHWIRE, 'Echo', arr[2]);
      } else {
        console.warn('$ Can not find peer');
      }
    } else if (arr[0] === 'lsp2p') {
      console.log('peers:');
      for (const [peerIdString] of node.peerpool.nodes[0].peerStore.peers.entries()) {
        console.log(peerIdString);
      }
    } else if (arr[0] === 'mine' || arr[0] === 'm') {
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
    } else if (arr[0] === 'batchmine' || arr[0] === 'bm') {
      try {
        for (let i = 0; i < 1000; i++) {
          const fromIndex = i % 2 === 0 ? 0 : 1;
          const toIndex = i % 2 !== 1 ? 0 : 1;
          const account = await node.stateManager.getAccount(Address.fromString(accounts[fromIndex]));
          const unsignedTx = Transaction.fromTxData(
            {
              gasLimit: '0x5208',
              gasPrice: '0x01',
              nonce: account.nonce,
              to: accounts[fromIndex],
              value: accounts[toIndex]
            },
            { common: node.common }
          );
          node.txPool.put(unsignedTx.sign(getPrivateKey(accounts[fromIndex])));

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
          console.log('new block', block.header.number.toString());
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } catch (err) {
        console.error('Run block error', err);
      }
    } else if (arr[0] === 'lsreceipt') {
      try {
        const receipt = await node.db.getReceipt(Buffer.from(arr[1]));
        console.log('hash:', arr[1], 'gasUsed:', new BN(receipt.gasUsed).toString(), 'status:', receipt.status);
      } catch (err) {
        console.error('Get receipt error', err);
      }
    } else if (arr[0] === 'lstx') {
      try {
        const tx = await node.db.getTransaction(Buffer.from(arr[1]));
        console.log('hash:', arr[1], 'from', tx.getSenderAddress().toString(), 'to', tx?.to?.toString(), 'value', tx.value.toString());
      } catch (err) {
        console.error('Get transaction error', err);
      }
    } else if (arr[0] === 'lsblock') {
      for (let h = 0; ; h++) {
        try {
          const block = await node.db.getBlock(h);
          console.log('block on height', h, ':', block.toJSON());
        } catch (err) {
          if (err.type === 'NotFoundError') {
            break;
          }
          throw err;
        }
      }
    } else if (arr[0] === 'lsheight') {
      const height = node.blockchain.latestHeight;
      const hash = node.blockchain.latestHash;
      console.log('local height:', height, 'hash:', hash);
    } else if (arr[0] === 'lsaccount') {
      const stream = node.stateManager._trie.createReadStream();
      for await (let data of streamToIterator(stream as any)) {
        console.log('key', '0x' + data.key.toString('hex'), '\nbalance', Account.fromRlpSerializedAccount(data.value).balance.toString());
      }
    } else if (arr[0] === 'getblock' || arr[0] === 'gb') {
      try {
        const block = await node.blockchain.getBlock(Number(arr[1]));
        console.log('0x' + block.header.hash().toString('hex'), block.toJSON());
      } catch (err) {
        console.error('Get block error:', err);
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
    const testdir = path.join(__dirname, './test-dir');
    if (!fs.existsSync(testdir)) {
      fs.mkdirSync(testdir);
    }
    const dir = path.join(testdir, args[0] || 'test-node-01');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    const node = new Node(dir);
    await node.init();
    await startPrompts(node);
  } catch (err) {
    console.error('Catch error', err);
  }
})();
