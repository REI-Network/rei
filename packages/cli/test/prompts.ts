import path from 'path';
import util from 'util';
import prompts from 'prompts';
import PeerId from 'peer-id';
import Multiaddr from 'multiaddr';
import { ENR } from '@chainsafe/discv5';
import { createKeypairFromPeerId } from '@chainsafe/discv5/lib/keypair';
import { Address, bufferToHex, BN } from 'ethereumjs-util';
import { Node } from '@gxchain2/core';
import { hexStringToBuffer, logger } from '@gxchain2/utils';
import { startNode } from '../src/start';
import program from '../src/program';
import { SIGINT } from '../src/process';
import { WrappedBlock } from '../../database/node_modules/@gxchain2/structure/dist';

// addresses, a list of address, splited by `,`
// topics, a list of topic, splited by `,` and each subTopic splited by `;`.
const parseAddressAndTopic = (addresses: string, topics: string) => {
  const addressArray = addresses ? addresses.split(',').map((addr) => Address.fromString(addr)) : [];
  const topicArray = topics
    ? topics.split(',').map((topic): Buffer[] | null => {
        return topic === 'null' ? null : topic.split(';').map((subTopic) => hexStringToBuffer(subTopic));
      })
    : [];
  return { addressArray, topicArray };
};

const handler: {
  [method: string]: (node: Node, ...args: string[]) => any;
} = {
  add: (node: Node, peerId: string) => {
    const pos = peerId.indexOf('/p2p/');
    (node.networkMngr as any).libp2pNode.peerStore.addressBook.set(PeerId.createFromB58String(peerId.substr(pos + 5)), [new Multiaddr(peerId.substr(0, pos))]);
  },
  // batch add.
  ba: (node: Node, peerIds: string) => {
    for (const str of peerIds.split(';')) {
      handler.add(node, str);
    }
  },
  rmpeer: async (node: Node, peerId: string) => {
    await node.networkMngr.removePeer(peerId);
    logger.info('removed');
  },
  lsenr: (node: Node, multiaddr: string) => {
    const ma = new Multiaddr(multiaddr);
    const peerId: PeerId = (node.networkMngr as any).libp2pNode.peerId;
    const keypair = createKeypairFromPeerId(peerId);
    const enr = ENR.createV4(keypair.publicKey);
    enr.setLocationMultiaddr(ma as any);
    logger.info('local:', enr.encodeTxt(keypair.privateKey));
  },
  lspeers: (node: Node) => {
    for (const peer of node.networkMngr.peers) {
      logger.info(peer.peerId);
    }
  },
  lsp2p: (node: Node) => {
    logger.info(Array.from((node.networkMngr as any).libp2pNode.connectionManager.connections.keys()));
    logger.info('size:', (node.networkMngr as any).libp2pNode.connectionManager.size);
  },
  lsreceipt: async (node: Node, hash: string) => {
    try {
      const receipt = await node.db.getReceipt(hexStringToBuffer(hash));
      logger.info(JSON.stringify(receipt.toRPCJSON()));
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
    const key = hashOrHeight.indexOf('0x') !== 0 ? Number(hashOrHeight) : hexStringToBuffer(hashOrHeight);
    const block = await node.db.getBlock(key);
    logger.info('block', bufferToHex(block.hash()), 'on height', block.header.number.toString(), ':', new WrappedBlock(block).toRPCJSON(true));
  },
  lsblock2: async (node: Node, hash: string, height: string) => {
    const block = await node.db.getBlockByHashAndNumber(hexStringToBuffer(hash), new BN(height));
    logger.info('block', bufferToHex(block.hash()), 'on height', block.header.number.toString(), ':', new WrappedBlock(block).toRPCJSON(true));
  },
  lsheight: (node: Node) => {
    const height = node.blockchain.latestHeight;
    const hash = node.blockchain.latestHash;
    logger.info('local height:', height, 'hash:', hash);
  },
  lsaccount: async (node: Node, address: string) => {
    const acc = await (await node.getStateManager(node.blockchain.latestBlock.header.stateRoot, node.blockchain.latestHeight)).getAccount(Address.fromString(address));
    logger.info('balance', acc.balance.toString(), 'nonce', acc.nonce.toString(), 'codeHash', acc.codeHash.toString('hex'));
  },
  lstxpool: async (node: Node) => {
    await node.txPool.ls();
  },
  lsscount: async (node: Node) => {
    const scount = await node.db.getStoredSectionCount();
    logger.info('scount', scount ? scount.toString() : 'undefined');
  },
  filterblock: async (node: Node, number: string, addresses: string, topics: string) => {
    const { addressArray, topicArray } = parseAddressAndTopic(addresses, topics);
    const filter = node.getFilter();
    const logs = await filter.filterBlock(new BN(number), addressArray, topicArray);
    logs.forEach((log) => logger.info(log.toRPCJSON()));
  },
  filterrange: async (node: Node, from: string, to: string, addresses: string, topics: string) => {
    const { addressArray, topicArray } = parseAddressAndTopic(addresses, topics);
    const filter = node.getFilter();
    const logs = await filter.filterRange(new BN(from), new BN(to), addressArray, topicArray);
    logs.forEach((log) => logger.info(log.toRPCJSON()));
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
      process.emit('SIGINT', 'SIGINT');
      break;
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
    program.parse(process.argv);
    const opts = program.opts();
    opts.datadir = path.isAbsolute(opts.datadir) ? opts.datadir : path.join(__dirname, './test-dir/', opts.datadir);
    const [node, sever] = await startNode(opts);
    SIGINT(node);
    if (opts.mine !== true) {
      await node.miner.setCoinbase(Address.fromString('0x3289621709f5b35d09b4335e129907ac367a0593'));
    }
    await startPrompts(node);
  } catch (err) {
    logger.error('Prompts start error:', err);
    process.exit(1);
  }
})();
