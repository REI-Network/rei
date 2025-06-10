import crypto from 'crypto';
import { expect } from 'chai';
import { Address, toBuffer, BN } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { Block, Log, Receipt, Transaction } from '@rei-network/structure';
import {
  Database,
  DBSaveReceipts,
  DBSetHashToNumber,
  DBSetBlockOrHeader,
  DBSaveLookups,
  DBOp
} from '@rei-network/database';
import Bloom from '@rei-network/vm/dist/bloom';
import { BloomBitsIndexer } from '../../src/indexer';
import {
  BloomBitsFilter,
  BloomBitsFilterBackend,
  ReceiptsCache,
  bloomBitsConfig
} from '../../src/bloomBits';
const level = require('level-mem');

const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);

const privateKey = toBuffer(
  '0xd8ca4883bbf62202904e402750d593a297b5640dea80b6d5b239c5a9902662c0'
);

type BloomInfo = {
  address: Buffer;
  topic: Buffer;
  data: Buffer;
  bloom: Buffer;
};

async function genRandomBlock(
  db: Database,
  parentNumber?: BN
): Promise<{ block: Block; info?: BloomInfo }> {
  if (!parentNumber) {
    const block = Block.fromBlockData(
      {
        header: {
          number: 0
        }
      },
      { common }
    );

    let batch: DBOp[] = [];
    batch = batch.concat(DBSetHashToNumber(block.hash(), block.header.number));
    batch = batch.concat(DBSaveLookups(block.hash(), block.header.number));
    batch = batch.concat(DBSetBlockOrHeader(block));
    await db.batch(batch);

    return { block };
  }

  const address = crypto.randomBytes(20);
  const topic = crypto.randomBytes(32);

  const _bloom = new Bloom();
  _bloom.add(address);
  _bloom.add(topic);
  const bloom = _bloom.bitvector;

  const data = crypto.randomBytes(32);
  const log = new Log(address, [topic], data);
  const receipt = new Receipt(toBuffer(0), bloom, [log], 1);
  const tx = Transaction.fromTxData({}, { common }).sign(privateKey);
  const parent = await db.getBlock(parentNumber);
  const parentHash = parent.hash();
  const block = Block.fromBlockData(
    {
      header: {
        bloom,
        parentHash,
        number: parentNumber ? parentNumber.addn(1) : 0
      },
      transactions: [tx]
    },
    { common }
  );

  let batch: DBOp[] = [];
  batch = batch.concat(DBSetHashToNumber(block.hash(), block.header.number));
  batch = batch.concat(DBSaveLookups(block.hash(), block.header.number));
  batch = batch.concat(DBSetBlockOrHeader(block));
  batch = batch.concat(
    DBSaveReceipts([receipt], block.hash(), block.header.number)
  );
  await db.batch(batch);

  return {
    block,
    info: {
      bloom,
      address,
      topic,
      data
    }
  };
}

function genMockBackend(
  db: Database,
  latestNumber: number
): BloomBitsFilterBackend {
  const receiptsCache = new ReceiptsCache();
  const latestBlock = Block.fromBlockData(
    { header: { number: new BN(latestNumber) } },
    { common }
  );
  return {
    db,
    receiptsCache,
    latestBlock
  };
}

describe('BloomBits', () => {
  describe('unindexed bloomBits', () => {
    const from = 0;
    const to = 25;
    const db = new Database(level(), common);
    const indexer = BloomBitsIndexer.createBloomBitsIndexer({ db });
    const blooms: BloomInfo[] = [];

    it('should init succeed', async () => {
      await indexer.init();
      indexer.start();
    });

    it('should put blocks succeed', async () => {
      let parentNumber: BN | undefined;
      for (let i = from; i <= to; i++) {
        const { block, info } = await genRandomBlock(db, parentNumber);
        if (info) {
          blooms.push(info);
        }
        parentNumber = block.header.number;
        await indexer.newBlockHeader(block.header);
      }
    });

    it('should filter succeed', async () => {
      const filter = new BloomBitsFilter(genMockBackend(db, to));
      for (const { address, topic, data } of blooms) {
        const logs = await filter.filterRange(
          new BN(from),
          new BN(to),
          [new Address(address)],
          [topic]
        );
        expect(logs.length).be.equal(1);
        expect(logs[0].address.equals(address)).be.true;
        expect(logs[0].topics.length).be.equal(1);
        expect(logs[0].topics[0].equals(topic)).be.true;
        expect(logs[0].data.equals(data)).be.true;
      }

      // wait until all blocks are processed
      await new Promise((r) => setTimeout(r, 100));

      const section = await db.getStoredSectionCount();
      expect(section?.toNumber()).be.equal(undefined);
    });

    it('should abort succeed', async () => {
      await indexer.abort();
    });
  });

  describe('indexed and unindexed bloomBits', () => {
    // change config
    bloomBitsConfig.bloomBitsSectionSize = 8;
    bloomBitsConfig.confirmsBlockNumber = 0;

    const from = 0;
    const to = 35;
    const db = new Database(level(), common);
    const indexer = BloomBitsIndexer.createBloomBitsIndexer({ db });
    const blooms: BloomInfo[] = [];

    it('should init succeed', async () => {
      await indexer.init();
      indexer.start();
    });

    it('should put blocks succeed', async () => {
      let parentNumber: BN | undefined;
      for (let i = from; i <= to; i++) {
        const { block, info } = await genRandomBlock(db, parentNumber);
        if (info) {
          blooms.push(info);
        }
        parentNumber = block.header.number;
        await indexer.newBlockHeader(block.header);
      }

      // wait until all blocks are processed
      await new Promise((r) => setTimeout(r, 100));

      const section = await db.getStoredSectionCount();
      expect(section?.toNumber()).be.equal(3);
    });

    it('should filter succeed', async () => {
      const filter = new BloomBitsFilter(genMockBackend(db, to));
      for (const { address, topic, data } of blooms) {
        const logs = await filter.filterRange(
          new BN(from),
          new BN(to),
          [new Address(address)],
          [topic]
        );
        expect(logs.length).be.equal(1);
        expect(logs[0].address.equals(address)).be.true;
        expect(logs[0].topics.length).be.equal(1);
        expect(logs[0].topics[0].equals(topic)).be.true;
        expect(logs[0].data.equals(data)).be.true;
      }
    });

    it('should abort succeed', async () => {
      await indexer.abort();
    });
  });
});
