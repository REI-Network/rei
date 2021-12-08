import fs from 'fs';
import path from 'path';
import { Common } from '../../../common/src';
import { expect } from 'chai';
import { WrappedBlock, Block } from '../../src';

describe('Blcok', () => {
  let testblock: Block;
  let wrappedTestBlcok: WrappedBlock;
  let testdata: any;

  before(() => {
    const common = Common.createChainStartCommon('rei-testnet');
    testdata = JSON.parse(fs.readFileSync(path.join(__dirname, '/test-data.json')).toString());
    testblock = Block.fromBlockData(testdata, { common, hardforkByBlockNumber: true });
    wrappedTestBlcok = new WrappedBlock(testblock);
  });

  it('should get block size', () => {
    expect(wrappedTestBlcok.size, 'block size should euqal').be.equal(parseInt(testdata.header.size));
  });

  it('should convert to rpcjson', () => {
    const rpcjson = wrappedTestBlcok.toRPCJSON();
    expect(rpcjson.number, 'number should be equal').be.equal(testdata.header.number);
    expect(rpcjson.hash, 'hash should be equal').be.equal(testdata.header.hash);
    expect(rpcjson.parentHash, 'parentHash should be equal').be.equal(testdata.header.parentHash);
    expect(rpcjson.nonce, 'nonce should be equal').be.equal(testdata.header.nonce);
    expect(rpcjson.sha3Uncles, 'sha3Uncles should be equal').be.equal(testdata.header.sha3Uncles);
    expect(rpcjson.logsBloom, 'logsBloom should be equal').be.equal(testdata.header.bloom);
    expect(rpcjson.stateRoot, 'stateRoot should be equal').be.equal(testdata.header.stateRoot);
    expect(rpcjson.receiptsRoot, 'receiptsRoot should be equal').be.equal(testdata.header.receiptTrie);
    expect(rpcjson.miner, 'miner should be equal').be.equal(testdata.header.coinbase);
    expect(rpcjson.mixHash, 'mixHash should be equal').be.equal(testdata.header.mixHash);
    expect(rpcjson.difficulty, 'difficulty should be equal').be.equal(testdata.header.difficulty);
    expect(rpcjson.totalDifficulty, 'totalDifficulty should be equal').be.equal(testdata.header.totalDifficulty);
    expect(rpcjson.extraData, 'extraData should be equal').be.equal(testdata.header.extraData);
    expect(rpcjson.size, 'size should be equal').be.equal(testdata.header.size);
    expect(rpcjson.gasLimit, 'gasLimit should be equal').be.equal(testdata.header.gasLimit);
    expect(rpcjson.gasUsed, 'gasUsed should be equal').be.equal(testdata.header.gasUsed);
    expect(rpcjson.timestamp, 'htimestampahs should be equal').be.equal(testdata.header.timestamp);
    rpcjson.transactions.forEach((trx, i) => {
      expect(trx, 'transaction hash should be euqal').be.equal(testdata.transactions[i].hash);
    });
    expect(rpcjson.uncles.length, 'uncles should be empty').be.equal(0);
  });
});
