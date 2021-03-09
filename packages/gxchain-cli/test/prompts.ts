import process from 'process';
import path from 'path';
import fs from 'fs';
import prompts from 'prompts';
import PeerId from 'peer-id';
import Multiaddr from 'multiaddr';
import BN from 'bn.js';
import { Address } from 'ethereumjs-util';
import { Node } from '@gxchain2/core';
import { RpcServer } from '@gxchain2/rpc';
import { constants } from '@gxchain2/common';
import { Transaction, WrappedTransaction } from '@gxchain2/tx';
import { hexStringToBuffer, logger } from '@gxchain2/utils';

const args = process.argv.slice(2);

// const accounts = ['0x3289621709f5b35d09b4335e129907ac367a0593', '0xd1e52f6eacbb95f5f8512ff129cbd6360e549b0b'];
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
      logger.warn('Invalid command');
      continue;
    }

    if (arr[0] === 'add' || arr[0] === 'a') {
      const pos = arr[1].indexOf('/p2p/');
      node.peerpool.nodes[0].peerStore.addressBook.set(PeerId.createFromB58String(arr[1].substr(pos + 5)), [new Multiaddr(arr[1].substr(0, pos))]);
    } else if (arr[0] === 'batchadd' || arr[0] === 'ba') {
      const add = (str: string) => {
        const pos = str.indexOf('/p2p/');
        node.peerpool.nodes[0].peerStore.addressBook.set(PeerId.createFromB58String(str.substr(pos + 5)), [new Multiaddr(str.substr(0, pos))]);
      };
      for (const str of arr[1].split(';')) {
        add(str);
        await new Promise((r) => setTimeout(r, 1500));
      }
    } else if (arr[0] === 'send' || arr[0] === 's') {
      const peer = node.peerpool.nodes[0].getPeer(arr[1]);
      if (peer) {
        peer.send(constants.GXC2_ETHWIRE, 'Echo', arr[2]);
      } else {
        logger.warn('Can not find peer');
      }
    } else if (arr[0] === 'lsp2p') {
      logger.info('peers:');
      for (const [peerIdString] of node.peerpool.nodes[0].peerStore.peers.entries()) {
        logger.info(peerIdString);
      }
    } else if (arr[0] === 'batchmine' || arr[0] === 'bm') {
      try {
        const count = Number.isInteger(Number(arr[1])) ? Number(arr[1]) : 1;
        for (let i = 0; i < count; i++) {
          await node.miner.mineBlock();
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } catch (err) {
        logger.error('Run block error:', err);
      }
    } else if (arr[0] === 'lsreceipt') {
      try {
        const receipt = await node.db.getReceipt(hexStringToBuffer(arr[1]));
        logger.info(receipt.toRPCJSON());
      } catch (err) {
        logger.error('Get receipt error:', err);
      }
    } else if (arr[0] === 'lstx') {
      try {
        const tx = await node.db.getWrappedTransaction(hexStringToBuffer(arr[1]));
        logger.info(tx.toRPCJSON());
      } catch (err) {
        if (err.type === 'NotFoundError') {
          continue;
        }
        logger.error('Get transaction error:', err);
      }
    } else if (arr[0] === 'lsblock') {
      const printBlock = async (key: number | Buffer): Promise<boolean> => {
        try {
          const block = await node.db.getBlock(key);
          logger.info('block', '0x' + block.hash().toString('hex'), 'on height', block.header.number.toString(), ':', block.toJSON());
          for (const tx of block.transactions) {
            logger.info('tx', '0x' + tx.hash().toString('hex'));
          }
          logger.info('---------------');
        } catch (err) {
          if (err.type === 'NotFoundError') {
            return false;
          }
          throw err;
        }
        return true;
      };
      if (arr[1]) {
        await printBlock(arr[1].indexOf('0x') !== 0 ? Number(arr[1]) : hexStringToBuffer(arr[1]));
      } else {
        for (let h = 0; await printBlock(h); h++) {}
      }
    } else if (arr[0] === 'lsheight') {
      const height = node.blockchain.latestHeight;
      const hash = node.blockchain.latestHash;
      logger.info('local height:', height, 'hash:', hash);
    } else if (arr[0] === 'lsaccount' || arr[0] === 'la') {
      try {
        const acc = await (await node.getStateManager(node.blockchain.latestBlock.header.stateRoot)).getAccount(Address.fromString(arr[1]));
        logger.info('balance', acc.balance.toString(), 'nonce', acc.nonce.toString(), 'codeHash', acc.codeHash.toString('hex'));
      } catch (err) {
        logger.error('Get account error:', err);
      }
    } else if (arr[0] === 'puttx') {
      const unsignedTx = Transaction.fromTxData(
        {
          gasLimit: new BN(21000),
          gasPrice: new BN(arr[4] || 1),
          nonce: new BN(arr[3] || 0),
          to: arr[2],
          value: '0x01'
        },
        { common: node.common }
      );
      const tx = unsignedTx.sign(getPrivateKey(arr[1]));
      logger.info('puttx 0x' + tx.hash().toString('hex'));
      await node.addPendingTxs([tx]);
    } else if (arr[0] === 'lstxpool') {
      await node.txPool.ls();
    } else if (arr[0] === 'newptx') {
      const [peerId, hash] = arr.slice(1);
      const peer = node.peerpool.getPeer(peerId);
      if (!peer) {
        logger.warn('Missing peer', peerId);
        continue;
      }
      peer.newPooledTransactionHashes([hexStringToBuffer(hash)]);
    } else if (arr[0] === 'getptx') {
      const [peerId, hash] = arr.slice(1);
      const peer = node.peerpool.getPeer(peerId);
      if (!peer) {
        logger.warn('Missing peer', peerId);
        continue;
      }
      const wtx = new WrappedTransaction((await peer.getPooledTransactions([hexStringToBuffer(hash)]))[0]);
      logger.info('Get pooled transaction:', wtx.toRPCJSON());
    } else {
      logger.warn('Invalid command');
      continue;
    }
  }
};

(async () => {
  try {
    const dirName = args[0] || 'test-node-01';
    const rpcPort = Number(args[1]) || 12358;
    const testdir = path.join(__dirname, './test-dir');
    if (!fs.existsSync(testdir)) {
      fs.mkdirSync(testdir);
    }
    const dir = path.join(testdir, dirName);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    const node = new Node({ databasePath: dir });
    await node.init();
    await node.miner.setCoinbase('0x3289621709f5b35d09b4335e129907ac367a0593');
    const rpcServer = new RpcServer(rpcPort, '127.0.0.1', node).on('error', (err: any) => {
      logger.error('Rpc server error:', err);
      process.exit(1);
    });
    if (!(await rpcServer.start())) {
      logger.error('RpcServer start failed, exit!');
      process.exit(1);
    }
    await startPrompts(node);
  } catch (err) {
    logger.error('Catch error:', err);
    process.exit(1);
  }
})();
