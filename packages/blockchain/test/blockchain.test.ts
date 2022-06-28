import crypto from 'crypto';
import { expect, assert } from 'chai';
import { Common } from '../../common/dist';
import { Database } from '../../database/dist';
import { Block } from '../../structure/dist';
import { Blockchain } from '../src';
import { BN } from 'bn.js';
const level = require('level-mem');

const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);
const genesisBlock = Block.fromBlockData({ header: common.genesis() }, { common });
const database = new Database(level(), common);

describe('Blockchain', () => {
  let blockchain!: Blockchain;

  before(async () => {
    blockchain = blockchain = new Blockchain({
      database: database,
      common,
      genesisBlock,
      validateBlocks: false,
      validateConsensus: false,
      hardforkByHeadBlockNumber: true
    });
    await blockchain.init();
  });

  it('should put block succeed', async () => {
    let last: Block = genesisBlock;
    for (let i = 0; i < 10; i++) {
      const block = Block.fromBlockData(
        {
          header: {
            parentHash: last.hash(),
            number: i + 1,
            difficulty: 1
          }
        },
        { common: common.copy(), hardforkByBlockNumber: true }
      );
      const reorg = await blockchain.putBlock(block);
      const header = await blockchain.getLatestHeader();
      expect(reorg).be.true;
      expect(header.number.toNumber()).equal(i + 1);
      last = block;
    }
  });

  it('should put block failed', async () => {
    const block = Block.fromBlockData(
      {
        header: {
          parentHash: crypto.randomBytes(32),
          number: 100,
          difficulty: 1
        }
      },
      { common: common.copy(), hardforkByBlockNumber: true }
    );

    try {
      await blockchain.putBlock(block);
      assert('should put failed');
    } catch (err) {
      // ignore error...
    }
  });

  it('should force put block succeed', async () => {
    const block = Block.fromBlockData(
      {
        header: {
          parentHash: crypto.randomBytes(32),
          number: 100,
          difficulty: 1
        }
      },
      { common: common.copy(), hardforkByBlockNumber: true }
    );

    const reorg = await blockchain.forcePutBlock(block, { td: new BN(100) });
    const header = await blockchain.getLatestHeader();
    const td = await blockchain.getTotalDifficulty(block.hash(), block.header.number);
    expect(reorg).be.true;
    expect(header.number.toNumber()).equal(100);
    expect(td.toNumber()).equal(100);
  });
});
