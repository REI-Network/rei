import path from 'path';
import util from 'util';
import prompts from 'prompts';
import PeerId from 'peer-id';
import Multiaddr from 'multiaddr';
import { Address, bufferToHex, BN } from 'ethereumjs-util';
import { Node } from '@gxchain2/core';
import { constants } from '@gxchain2/common';
import { TransactionFactory } from '@gxchain2/tx';
import { hexStringToBuffer, logger } from '@gxchain2/utils';
import { BloomBitsFilter } from '@gxchain2/core/dist/bloombits';
import { startNode } from '../src/start';
import program from '../src/program';
import { SIGINT } from '../src/process';

const keyPair = new Map<string, Buffer>([
  ['0x3289621709f5b35d09b4335e129907ac367a0593', Buffer.from('d8ca4883bbf62202904e402750d593a297b5640dea80b6d5b239c5a9902662c0', 'hex')],
  ['0xd1e52f6eacbb95f5f8512ff129cbd6360e549b0b', Buffer.from('db0558cc5f24dd09c390a25c7958a678e7efa0f286053da5df53dcecdba2a13c', 'hex')]
]);

const getPrivateKey = (address: string): Buffer => {
  return keyPair.get(address)!;
};

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
    for (const peer of node.peerpool.peers) {
      logger.info(peer.peerId);
    }
  },
  // batch mine block.
  bm: async (node: Node, strCount?: string) => {
    const count = isNaN(Number(strCount)) ? 1 : Number(strCount);
    for (let i = 0; i < count; i++) {
      await node.miner.mint();
      await new Promise((r) => setTimeout(r, 1000));
    }
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
    const acc = await (await node.getStateManager(node.blockchain.latestBlock.header.stateRoot, node.blockchain.latestHeight)).getAccount(Address.fromString(address));
    logger.info('balance', acc.balance.toString(), 'nonce', acc.nonce.toString(), 'codeHash', acc.codeHash.toString('hex'));
  },
  puttx: async (node: Node, from: string, to: string, nonce?: string, gasPrice?: string) => {
    const unsignedTx = TransactionFactory.fromTxData(
      {
        gasLimit: new BN(21000),
        gasPrice: new BN(gasPrice || 1),
        nonce: new BN(nonce || 0),
        to,
        value: '0x01'
      },
      { common: node.getCommon(node.blockchain.latestHeight) }
    );
    const tx = unsignedTx.sign(getPrivateKey(from));
    const results = await node.addPendingTxs([tx]);
    if (results[0]) {
      logger.info('puttx', bufferToHex(tx.hash()));
    }
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
    const filter = new BloomBitsFilter({ node, sectionSize: constants.BloomBitsBlocks });
    const logs = await filter.filterBlock(new BN(number), addressArray, topicArray);
    logs.forEach((log) => logger.info(log.toRPCJSON()));
  },
  filterrange: async (node: Node, from: string, to: string, addresses: string, topics: string) => {
    const { addressArray, topicArray } = parseAddressAndTopic(addresses, topics);
    const filter = new BloomBitsFilter({ node, sectionSize: constants.BloomBitsBlocks });
    const logs = await filter.filterRange(new BN(from), new BN(to), addressArray, topicArray);
    logs.forEach((log) => logger.info(log.toRPCJSON()));
  },
  lsbits: async (node: Node, strBit: string, strSection: string, strHead: string) => {
    const section = new BN(strSection);
    const headHash = strHead ? Buffer.from(strHead, 'hex') : (await node.db.getCanonicalHeader(section.addn(1).muln(constants.BloomBitsBlocks).subn(1))).hash();
    const bits = await node.db.getBloomBits(Number(strBit), section, headHash);
    logger.info('bits', Buffer.from(bits).toString('hex'));
  },
  rexec: async (node: Node, number: string) => {
    const block = await node.db.getBlock(Number(number));
    const parentHeader = await node.db.getHeader(block.header.parentHash, block.header.number.subn(1));
    const wvm = await node.getWrappedVM(parentHeader.stateRoot, parentHeader.number);
    await wvm.runBlock({
      block,
      generate: false,
      root: parentHeader.stateRoot,
      fff: true
    } as any);
    logger.info('rexec', block.header.number.toNumber(), 'successfully');
  },
  ga: async (node: Node, root: string, address: string) => {
    const stateManager = await node.getStateManager(hexStringToBuffer(root), 0);
    console.log(await stateManager.getAccount(Address.fromString(address)));
  },
  cs: async (node: Node, number: string) => {
    const block = await node.db.getBlock(Number(number));
    console.log(block.header.cliqueSigner().toString());
  },
  ts: async (node: Node, number: string, address1: string, address2: string) => {
    const addr1 = Address.fromString(address1);
    const addr2 = Address.fromString(address2);
    const block = await node.db.getBlock(Number(number));
    const stateManager = await node.getStateManager(block.header.stateRoot, block.header.number);
    await stateManager.checkpoint();
    let account1 = await stateManager.getAccount(addr1);
    let account2 = await stateManager.getAccount(addr2);
    console.log('before test', block.header.stateRoot.toString('hex'), account1, account2);
    account1.balance.iaddn(100);
    await stateManager.putAccount(addr1, account1);
    await stateManager.commit();
    account1 = await stateManager.getAccount(addr1);
    account2 = await stateManager.getAccount(addr2);
    console.log('after test', (await stateManager.getStateRoot()).toString('hex'), account1, account2);
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
      node.miner.setCoinbase('0x3289621709f5b35d09b4335e129907ac367a0593');
    }
    await startPrompts(node);
  } catch (err) {
    logger.error('Prompts start error:', err);
    process.exit(1);
  }
})();
