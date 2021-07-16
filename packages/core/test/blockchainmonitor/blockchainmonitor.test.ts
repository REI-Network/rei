import process from 'process';
import { Block, Log } from '@gxchain2/structure';
import { hexStringToBuffer, setLevel } from '@gxchain2/utils';
import { DBSaveTxLookup, DBSaveReceipts } from '@gxchain2/database';
import { RunBlockDebugOpts } from '@gxchain2/vm/dist/runBlock';
import { Node } from '../../src';
import { createNode, destroyNode, loadBlocksFromTestData } from '../util';
import { keccak256 } from 'ethereumjs-util';

setLevel('silent');
const dirname = 'blockchainMonitor';
const address = '0x3289621709f5b35d09b4335e129907ac367a0593';
const privateKey = '0xd8ca4883bbf62202904e402750d593a297b5640dea80b6d5b239c5a9902662c0';

describe('BlockchainMonitor', async () => {
  let node: Node;
  let fork1: Block[];
  let fork2: Block[];

  async function processBlock(block: Block) {
    const lastHeader = await node.db.getHeader(block.header.parentHash, block.header.number.subn(1));
    const runBlockOptions: RunBlockDebugOpts = {
      block,
      root: lastHeader.stateRoot,
      generate: true,
      skipNonce: false,
      skipBlockValidation: true,
      skipBalance: true
    };
    const { result, block: newBlock } = await (await node.getWrappedVM(lastHeader.stateRoot, lastHeader.number)).runBlock(runBlockOptions);
    block = newBlock || block;
    const before = node.blockchain.latestBlock.hash();
    await node.blockchain.putBlock(block);
    await node.db.batch(DBSaveTxLookup(block).concat(DBSaveReceipts(result.receipts, block.hash(), block.header.number)));
    const after = node.blockchain.latestBlock.hash();
    if (!before.equals(after)) {
      await node.bcMonitor.newBlock(block);
    }
    return block;
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
      if (newBlockHashSet.size !== eventSet.size) {
        console.log(newBlockHashSet, eventSet);
        throw new Error("missing 'newHeads' event");
      }
      for (const hash of newBlockHashSet) {
        newBlockHashSet.delete(hash);
        eventSet.delete(hash);
      }
      if (newBlockHashSet.size !== 0 || eventSet.size !== 0) {
        throw new Error("missing 'newHeads' event");
      }
      if (logs.length !== 1 || logs[0].removed !== false || !keccak256(logs[0].serialize()).equals(hexStringToBuffer('81a93f1b18562fe496865812f8cff49db870421fe889ffb11b3fc13aacc8d125'))) {
        throw new Error('missing or invalid log');
      }
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
      if (removedLogs.length !== 1 || removedLogs[0].removed !== true || !keccak256(removedLogs[0].serialize()).equals(hexStringToBuffer('81a93f1b18562fe496865812f8cff49db870421fe889ffb11b3fc13aacc8d125'))) {
        throw new Error('missing or invalid log');
      }
    } finally {
      node.bcMonitor.off('removedLogs', onRemovedLogs);
    }
  });

  after(async () => {
    await destroyNode(dirname, node);
    process.exit(0);
  });
});
