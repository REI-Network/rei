import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { LevelUp } from 'levelup';
import { Address } from 'ethereumjs-util';
import { Database, createEncodingLevelDB } from '@gxchain2/database';
import { Block, BlockData } from '@gxchain2/structure';
import { Common } from '../../common/src';
import { Blockchain } from '../src';

describe('Blockchain', () => {
  let blockchain: Blockchain;
  let database: Database;
  let testsigners: Address[];
  let testdb: LevelUp;
  let testdir: string;
  let testblocks: Block[];

  before(async () => {
    testdir = path.join(__dirname, '/test-dir');
    if (!fs.existsSync(testdir)) {
      fs.mkdirSync(testdir, { recursive: true });
    }
    testdb = createEncodingLevelDB(testdir);
    const common = Common.createChainStartCommon('gxc2-testnet');
    const genesisBlock = Block.genesis({ header: common.genesis() }, { common });
    testsigners = genesisBlock.header.cliqueEpochTransitionSigners();
    database = new Database(testdb, common);
    blockchain = new Blockchain({
      db: testdb,
      database,
      common,
      genesisBlock
    });
    await blockchain.init();

    const testdata: { blocks: BlockData[] } = JSON.parse(fs.readFileSync(path.join(__dirname, '/test-data.json')).toString());
    testblocks = testdata.blocks.map((bd) => Block.fromBlockData(bd, { common, hardforkByBlockNumber: true }));
  });

  it('should put blocks', async () => {
    for (const block of testblocks) {
      await blockchain.putBlock(block);
    }
  });

  it('should get latest block', () => {
    const lastestBlock = blockchain.latestBlock;
    expect(lastestBlock.hash().equals(testblocks[testblocks.length - 1].hash()), 'hash should be equal').be.true;
  });

  it('should get clique active signers by block number', () => {
    const signers = blockchain.cliqueActiveSignersByBlockNumber(testblocks[testblocks.length - 1].header.number);
    const include = (signer: Address) => {
      return testsigners.filter((addr) => addr.equals(signer)).length > 0;
    };
    expect(
      signers.reduce((b, signer) => b && include(signer), true),
      'signer should be valid'
    ).be.true;
  });

  it('should check clique next recently signed', () => {
    const lastestBlock = blockchain.latestBlock;
    expect(blockchain.cliqueCheckNextRecentlySigned(lastestBlock.header, lastestBlock.header.cliqueSigner()), 'if recently signed happend, should be true').be.true;
    const validSigner = testblocks[testblocks.length - 2].header.cliqueSigner();
    expect(blockchain.cliqueCheckNextRecentlySigned(lastestBlock.header, validSigner), 'if signer is valid, should be false').be.false;
  });

  after(async () => {
    await testdb.close();
    fs.rmdirSync(testdir, { recursive: true });
  });
});
