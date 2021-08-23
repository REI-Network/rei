import { expect } from 'chai';
import { Block, Log } from '@gxchain2/structure';
import { hexStringToBuffer, setLevel } from '@gxchain2/utils';
import { Node } from '../../src';
import { createNode, destroyNode, loadBlocksFromTestData } from '../util';

setLevel('silent');
const dirname = 'blockchainMonitor';
const address = '0x3289621709f5b35d09b4335e129907ac367a0593';
const privateKey = '0xd8ca4883bbf62202904e402750d593a297b5640dea80b6d5b239c5a9902662c0';

describe('BlockchainMonitor', async () => {
  let node: Node;
  let fork1: Block[];
  let fork2: Block[];

  async function processBlock(block: Block) {
    const newBlock = await node.processBlock(block, { generate: true, broadcast: false, skipNonce: false, skipBlockValidation: true, skipBalance: true } as any);
    return newBlock;
  }

  before(async () => {
    node = await createNode(dirname, 'gxc2-testnet');
    (node.blockchain as any)._validateBlocks = false;
    (node.blockchain as any)._validateConsensus = false;
    await node.accMngr.importKeyByPrivateKey(privateKey, '123');
    await node.accMngr.unlock(address, '123');
    fork1 = loadBlocksFromTestData(dirname, 'fork1', 'gxc2-testnet', hexStringToBuffer(privateKey));
    fork2 = loadBlocksFromTestData(dirname, 'fork2', 'gxc2-testnet', hexStringToBuffer(privateKey));
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
      // sleep a while, make sure bcMonitor.newBlock has been called
      await new Promise((r) => setTimeout(r, 200));
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
      expect(logs.length, 'logs length should be 1').be.equal(1);
      expect(logs[0].removed === false, "log shouldn't be removed").be.true;
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
      // sleep a while, make sure bcMonitor.newBlock has been called
      await new Promise((r) => setTimeout(r, 200));
      expect(removedLogs.length, 'removedLogs length should be 1').be.equal(1);
      expect(removedLogs[0].removed === true, 'log should be removed').be.true;
    } finally {
      node.bcMonitor.off('removedLogs', onRemovedLogs);
    }
  });

  after(async () => {
    await destroyNode(dirname, node);
  });
});
