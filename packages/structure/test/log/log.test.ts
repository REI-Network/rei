import path from 'path';
import fs from 'fs';
import { Common } from '@gxchain2/common';
import { Block, Transaction, Log, Receipt } from '../../dist';
import { BN } from 'ethereumjs-util';
import { hexStringToBN, hexStringToBuffer } from '@gxchain2/utils';
import { expect } from 'chai';

describe('Log', () => {
  let testdata: any;
  let testblock: Block;
  let testTransaction: Transaction;
  let testreceipt: Receipt;
  let testLog: Log;

  before(() => {
    const common = Common.createChainStartCommon('gxc2-testnet');
    testdata = JSON.parse(fs.readFileSync(path.join(__dirname, '/test-data.json')).toString());
    testblock = Block.fromBlockData(testdata, { common, hardforkByBlockNumber: true });
    testTransaction = Transaction.fromTxData(testdata.transactions[0]);
    testLog = new Log(
      hexStringToBuffer(testdata.log.address),
      testdata.log.topics.map((t) => {
        return hexStringToBuffer(t);
      }),
      hexStringToBuffer(testdata.log.data)
    );
    testreceipt = new Receipt(hexStringToBuffer(testdata.receipt.cumulativeGasUsed), hexStringToBuffer(testdata.receipt.bitvector), [testLog], hexStringToBN(testdata.receipt.status).toNumber() as 0 | 1);
    const gasUsed = testreceipt.bnCumulativeGasUsed.sub(new BN(0));
    testreceipt.installProperties(testblock, testTransaction, gasUsed, 0);
    testLog.installProperties(testreceipt, 0);
  });

  it('shoud fromRlpSerializedLog correctly ', () => {
    const fromrlpLog = Log.fromRlpSerializedLog(testdata.log_serialize.serialize);
    expect(fromrlpLog.address.equals(testLog.address), 'address should be euqal').be.true;
    expect(fromrlpLog.data.equals(testLog.data), 'data should be euqal').be.true;
    fromrlpLog.topics.forEach((r, i) => {
      expect(r.equals(testLog.topics[i]), 'topics member should be equal').be.true;
    });
  });

  it('should fromValuesArray correctly', () => {
    const fromvaluesLog = Log.fromValuesArray([
      hexStringToBuffer(testdata.log_raw.address),
      testdata.log_raw.topics.map((r) => {
        return hexStringToBuffer(r);
      }),
      hexStringToBuffer(testdata.log_raw.data)
    ]);
    expect(fromvaluesLog.serialize().equals(testLog.serialize()), 'serialized data should be true').be.true;
  });

  it('should get raw', () => {
    const raw = testLog.raw();
    expect((raw[0] as Buffer).equals(hexStringToBuffer(testdata.log_raw.address)), 'address should be equal').be.true;
    expect((raw[2] as Buffer).equals(hexStringToBuffer(testdata.log_raw.data)), 'data should be equal').be.true;
    (raw[1] as Buffer[]).forEach((r, i) => {
      expect(r.equals(hexStringToBuffer(testdata.log_raw.topics[i])), 'topics member should be equal').be.true;
    });
  });

  it('should get serialize', () => {
    expect(testLog.serialize().equals(hexStringToBuffer(testdata.log_serialize.serialize)), 'serialized data should be equal').be.true;
  });

  it('should convert to rpcjson', () => {
    const logJson = testLog.toRPCJSON();
    const logdata = testdata.log;
    expect(logJson.address, 'address should be equal').be.equal(logdata.address);
    expect(logJson.blockNumber, 'blockNumber should be equal').be.equal(logdata.blockNumber);
    expect(logJson.blockHash, 'blockHash should be equal').be.equal(logdata.blockHash);
    expect(logJson.data, 'data should be equal').be.equal(logdata.data);
    expect(logJson.logIndex, 'logIndex should be equal').be.equal(logdata.logIndex);
    expect(logJson.transactionHash, 'transactionHash should be equal').be.equal(logdata.transactionHash);
    expect(logJson.transactionIndex, 'transactionIndex should be equal').be.equal(logdata.transactionIndex);
    logJson.topics.forEach((r, i) => {
      expect(r, 'topics member should be equal').be.equal(logdata.topics[i]);
    });
  });
});
