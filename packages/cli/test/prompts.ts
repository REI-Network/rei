import util from 'util';
import prompts from 'prompts';
import PeerId from 'peer-id';
import { Multiaddr } from 'multiaddr';
import { program } from 'commander';
import { Address, bufferToHex, BN } from 'ethereumjs-util';
import { Node } from '@gxchain2/core';
import { ExtraData } from '@gxchain2/core/dist/consensus/reimint/types';
import { hexStringToBuffer, logger } from '@gxchain2/utils';
import { startNode, installOptions } from '../src/commands';
import { SIGINT } from '../src/process';
import { WrappedBlock } from '../../structure/dist';

installOptions(program);

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
  ban: async (node: Node, peerId: string) => {
    await node.networkMngr.ban(peerId);
    logger.info('removed');
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
    } catch (err: any) {
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
    } catch (err: any) {
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
  lv: async (node: Node) => {
    const state = node.getReimintEngine()!.state as any;
    console.log('state:', state.height.toString(), state.round, state.step);
    const rvotes = state.votes.roundVoteSets;
    for (let i = 0; i < 2; i++) {
      if (!rvotes.has(i)) {
        break;
      }
      const { prevotes, precommits } = rvotes.get(i);
      const print = (name, set) => {
        console.log(
          'name:',
          name,
          'content:',
          set.votes.map((v) => {
            if (v === undefined) {
              return undefined;
            } else {
              return v.validator();
            }
          })
        );
      };
      console.log('=========', i, '=========');
      print('prevotes:', prevotes);
      print('precommits:', precommits);
      console.log('---------', i, '---------');
    }
  },
  lh: async (node: Node, h: string) => {
    const parentBlock = await node.db.getBlock(new BN(h).subn(1));
    const block = await node.db.getBlock(new BN(h));
    const stakeManager = node.getStakeManager(await node.getVM(parentBlock.header.stateRoot, parentBlock._common), parentBlock);
    const validatorSet = await node.validatorSets.get(parentBlock.header.stateRoot, stakeManager);
    // console.log('val:', validatorSet);
    // console.log(ExtraData.fromBlockHeader(block.header));
    console.log('----------------');
    console.log(
      ExtraData.fromBlockHeader(block.header, {
        valSet: validatorSet,
        increaseValSet: true
      })
    );
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
    const [node] = await startNode(opts);
    SIGINT(node);
    await startPrompts(node);
  } catch (err) {
    logger.error('Prompts start error:', err);
    process.exit(1);
  }
})();
