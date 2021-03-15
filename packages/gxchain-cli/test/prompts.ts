import process from 'process';
import path from 'path';
import fs from 'fs';
import util from 'util';
import prompts from 'prompts';
import PeerId from 'peer-id';
import Multiaddr from 'multiaddr';
import { Address, bufferToHex, BN } from 'ethereumjs-util';
import { Node } from '@gxchain2/core';
import { RpcServer } from '@gxchain2/rpc';
import { constants } from '@gxchain2/common';
import { Transaction } from '@gxchain2/tx';
import { hexStringToBuffer, logger } from '@gxchain2/utils';

const args = process.argv.slice(2);

const keyPair = new Map<string, Buffer>([
  ['0x3289621709f5b35d09b4335e129907ac367a0593', Buffer.from('d8ca4883bbf62202904e402750d593a297b5640dea80b6d5b239c5a9902662c0', 'hex')],
  ['0xd1e52f6eacbb95f5f8512ff129cbd6360e549b0b', Buffer.from('db0558cc5f24dd09c390a25c7958a678e7efa0f286053da5df53dcecdba2a13c', 'hex')]
]);

const getPrivateKey = (address: string): Buffer => {
  return keyPair.get(address)!;
};

const handler: {
  [method: string]: (node: Node, ...args: string[]) => any;
} = {
  add: (node: Node, peerId: string) => {
    const pos = peerId.indexOf('/p2p/');
    node.peerpool.nodes[0].peerStore.addressBook.set(PeerId.createFromB58String(peerId.substr(pos + 5)), [new Multiaddr(peerId.substr(0, pos))]);
  },
  // batch add.
  ba: (node: Node, peerIds: string) => {
    for (const str of peerIds.split(';')) {
      handler.add(node, str);
    }
  },
  send: (node: Node, peerId: string, message: string) => {
    const peer = node.peerpool.getPeer(peerId);
    if (peer) {
      peer.send(constants.GXC2_ETHWIRE, 'Echo', message);
    } else {
      logger.warn('Can not find peer');
    }
  },
  lsp2p: (node: Node) => {
    for (const [peerIdString] of node.peerpool.nodes[0].peerStore.peers.entries()) {
      logger.info(peerIdString);
    }
  },
  // batch mine block.
  bm: async (node: Node, strCount?: string) => {
    const count = isNaN(Number(strCount)) ? 1 : Number(strCount);
    for (let i = 0; i < count; i++) {
      await node.miner.mineBlock();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  },
  lsreceipt: async (node: Node, hash: string) => {
    try {
      const receipt = await node.db.getReceipt(hexStringToBuffer(hash));
      logger.info(receipt.toRPCJSON());
    } catch (err) {
      if (err.type === 'NotFoundError') {
        return;
      }
      throw err;
    }
  },
  lstx: async (node: Node, hash: string) => {
    try {
      const tx = await node.db.getWrappedTransaction(hexStringToBuffer(hash));
      logger.info(tx.toRPCJSON());
    } catch (err) {
      if (err.type === 'NotFoundError') {
        return;
      }
      throw err;
    }
  },
  lsblock: async (node: Node, hashOrHeight: string) => {
    const printBlock = async (key: number | Buffer) => {
      try {
        const block = await node.db.getBlock(key);
        logger.info('block', bufferToHex(block.hash()), 'on height', block.header.number.toString(), ':', block.toJSON());
        for (const tx of block.transactions) {
          logger.info('tx', bufferToHex(tx.hash()));
        }
        logger.info('---------------');
      } catch (err) {
        if (err.type === 'NotFoundError') {
          return;
        }
        throw err;
      }
      return;
    };
    await printBlock(hashOrHeight.indexOf('0x') !== 0 ? Number(hashOrHeight) : hexStringToBuffer(hashOrHeight));
  },
  lsheight: (node: Node) => {
    const height = node.blockchain.latestHeight;
    const hash = node.blockchain.latestHash;
    logger.info('local height:', height, 'hash:', hash);
  },
  lsaccount: async (node: Node, address: string) => {
    const acc = await (await node.getStateManager(node.blockchain.latestBlock.header.stateRoot)).getAccount(Address.fromString(address));
    logger.info('balance', acc.balance.toString(), 'nonce', acc.nonce.toString(), 'codeHash', acc.codeHash.toString('hex'));
  },
  puttx: async (node: Node, from: string, to: string, nonce?: string, gasPrice?: string) => {
    const unsignedTx = Transaction.fromTxData(
      {
        gasLimit: new BN(21000),
        gasPrice: new BN(gasPrice || 1),
        nonce: new BN(nonce || 0),
        to,
        value: '0x01'
      },
      { common: node.common }
    );
    const tx = unsignedTx.sign(getPrivateKey(from));
    const results = await node.addPendingTxs([tx]);
    if (results[0]) {
      logger.info('puttx', bufferToHex(tx.hash()));
    }
  },
  lstxpool: async (node: Node) => {
    await node.txPool.ls();
  }
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

    try {
      const [method, ...args] = (response.cmd as string).split(' ');
      const result = handler[method](node, ...args);
      if (util.types.isPromise(result)) {
        await result;
      }
    } catch (err) {
      logger.error('Prompts catch error:', err);
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
    node.miner.setCoinbase('0x3289621709f5b35d09b4335e129907ac367a0593');
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
