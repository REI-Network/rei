import util from 'util';
import prompts from 'prompts';
import PeerId from 'peer-id';
import Multiaddr from 'multiaddr';
import { program } from 'commander';
import { Address, bufferToHex, BN } from 'ethereumjs-util';
import { Node } from '@rei-network/core';
import { ExtraData } from '@rei-network/core/dist/consensus/reimint/extraData';
import { hexStringToBuffer } from '@rei-network/utils';
import { startNode, installOptions } from '../src/commands';
import { SIGINT } from '../src/process';

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
    console.log('removed');
  },
  ban: async (node: Node, peerId: string) => {
    await node.networkMngr.ban(peerId);
    console.log('removed');
  },
  lspeers: (node: Node) => {
    for (const peer of node.networkMngr.peers) {
      console.log(peer.peerId);
    }
  },
  lsp2p: (node: Node) => {
    console.log(Array.from((node.networkMngr as any).libp2pNode.connectionManager.connections.keys()));
    console.log('size:', (node.networkMngr as any).libp2pNode.connectionManager.size);
  },
  lsreceipt: async (node: Node, hash: string) => {
    try {
      const receipt = await node.db.getReceipt(hexStringToBuffer(hash));
      console.log(JSON.stringify(receipt.toRPCJSON()));
    } catch (err: any) {
      if (err.type === 'NotFoundError') {
        return;
      }
      throw err;
    }
  },
  lstx: async (node: Node, hash: string) => {
    try {
      const tx = await node.db.getTransaction(hexStringToBuffer(hash));
      console.log(tx.toRPCJSON());
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
    console.log('block', bufferToHex(block.hash()), 'on height', block.header.number.toString(), ':', block.toRPCJSON(true, false));
  },
  lsblock2: async (node: Node, hash: string, height: string) => {
    const block = await node.db.getBlockByHashAndNumber(hexStringToBuffer(hash), new BN(height));
    console.log('block', bufferToHex(block.hash()), 'on height', block.header.number.toString(), ':', block.toRPCJSON(false, false));
  },
  lsheight: (node: Node) => {
    const block = node.getLatestBlock();
    console.log('local height:', block.header.number.toString(), 'hash:', bufferToHex(block.hash()));
  },
  lsaccount: async (node: Node, address: string) => {
    const block = node.getLatestBlock();
    const acc = await (await node.getStateManager(block.header.stateRoot, block._common)).getAccount(Address.fromString(address));
    console.log('balance:', acc.balance.toString(), 'nonce:', acc.nonce.toString(), 'codeHash:', acc.codeHash.toString('hex'), 'stateRoot:', acc.stateRoot.toString('hex'));
    const stakeInfo = acc.getStakeInfo();
    console.log('total:', stakeInfo.total.toString(), 'usage:', stakeInfo.usage.toString(), 'timestamp:', stakeInfo.timestamp, 'estimateUsage:', stakeInfo.estimateUsage(block.header.timestamp.toNumber()).toString());
  },
  lstxpool: async (node: Node) => {
    await node.txPool.ls();
  },
  lstate: async (node: Node) => {
    const state = node.reimint.state as any;
    console.log('state(h,r,s):', state.height.toString(), state.round, state.step);
    const roundVotes = state.votes.roundVoteSets;

    const print = (name, set) => {
      console.log(
        'name:',
        name,
        'content:',
        set.votes.map((v) => {
          if (v === undefined) {
            return undefined;
          } else {
            return v.validator().toString();
          }
        })
      );
    };

    for (let i = 0; ; i++) {
      if (!roundVotes.has(i)) {
        break;
      }
      const { prevotes, precommits } = roundVotes.get(i);
      console.log('========= round:', i, '=========');
      print('prevotes:', prevotes);
      print('precommits:', precommits);
      console.log('--------- round:', i, '---------');
    }
  },
  lsex: async (node: Node, h: string) => {
    const parentBlock = await node.db.getBlock(new BN(h).subn(1));
    const block = await node.db.getBlock(new BN(h));
    const common = block._common;
    const stakeManager = node.reimint.getStakeManager(await node.getVM(parentBlock.header.stateRoot, common), parentBlock, common);
    const validatorSet = await node.reimint.validatorSets.getActiveValSet(parentBlock.header.stateRoot, stakeManager);
    console.log('----------------');
    console.log(
      ExtraData.fromBlockHeader(block.header, {
        valSet: validatorSet
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
      console.log('Prompts catch error:', err);
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
    console.log('Prompts start error:', err);
    process.exit(1);
  }
})();
