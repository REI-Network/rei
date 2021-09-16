import { expect } from 'chai';
import { Block, Log } from '@gxchain2/structure';
import { setLevel } from '@gxchain2/utils';
import { Node } from '../../src';
import { createNode, destroyNode, loadBlocksFromTestData } from '../util';

setLevel('silent');
const dirname = 'blockchainMonitor';

describe('BlockchainMonitor', async () => {
  let node: Node;
  let fork1: Block[];
  let fork2: Block[];

  async function processBlock(block: Block) {
    await new Promise<void>(async (resolve) => {
      block = await node.processBlock(block, {
        onFinished: () => {
          resolve();
        },
        broadcast: false,
        skipConsensusValidation: true,
        runTxOpts: { skipNonce: true }
      });
    });
    return block;
  }

  before(async () => {
    node = await createNode(dirname, 'gxc2-testnet');
    fork1 = loadBlocksFromTestData(dirname, 'fork1', 'gxc2-testnet');
    fork2 = loadBlocksFromTestData(dirname, 'fork2', 'gxc2-testnet');
  });

  it("should emit 'newHeads' and 'logs' event", async () => {
    const newBlockHashSet = new Set<string>();
    const eventSet = new Set<string>();
    let logs: Log[] = [];
    const onNewHeads = (hashes: Buffer[]) => {
      hashes.forEach((hash) => {
        eventSet.add(hash.toString('hex'));
      });
    };
    const onLogs = (_logs: Log[]) => {
      logs = logs.concat(_logs);
    };
    try {
      node.bcMonitor.on('newHeads', onNewHeads);
      node.bcMonitor.on('logs', onLogs);
      for (const block of fork1) {
        const newBlock = await processBlock(block);
        newBlockHashSet.add(newBlock.hash().toString('hex'));
      }
      if (newBlockHashSet.size !== eventSet.size) {
        throw new Error("missing 'newHeads' event");
      }
      expect(newBlockHashSet.size, 'set size should be equal').be.equal(eventSet.size);
      for (const hash of newBlockHashSet) {
        newBlockHashSet.delete(hash);
        eventSet.delete(hash);
      }
      expect(newBlockHashSet.size, 'set size should be zero').be.equal(0);
      expect(eventSet.size, 'set size should be zero').be.equal(0);
      expect(logs.length, 'logs length should be 1').be.equal(2);
      expect(logs[0].removed === false, "log shouldn't be removed").be.true;
      expect(logs[1].removed === false, "log shouldn't be removed").be.true;
    } finally {
      node.bcMonitor.off('newHeads', onNewHeads);
      node.bcMonitor.off('logs', onLogs);
    }
  });

  it("should emit 'removedLogs' event", async () => {
    let removedLogs: Log[] = [];
    const onRemovedLogs = (_logs: Log[]) => {
      removedLogs = removedLogs.concat(_logs);
    };
    try {
      node.bcMonitor.on('removedLogs', onRemovedLogs);
      for (const block of fork2) {
        await processBlock(block);
      }
      expect(removedLogs.length, 'removedLogs length should be 1').be.equal(2);
      expect(removedLogs[0].removed === true, 'log should be removed').be.true;
      expect(removedLogs[1].removed === true, 'log should be removed').be.true;
    } finally {
      node.bcMonitor.off('removedLogs', onRemovedLogs);
    }
  });

  after(async () => {
    await destroyNode(dirname, node);
  });
});
