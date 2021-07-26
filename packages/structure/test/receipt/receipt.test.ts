import path from 'path';
import fs from 'fs';
import { Common } from '@gxchain2/common';
import { Block, Transaction, Log, Receipt, ReceiptRawValue } from '../../dist';
import { hexStringToBuffer, hexStringToBN } from '@gxchain2/utils';
import { BN, generateAddress } from 'ethereumjs-util';
import { expect } from 'chai';

describe('Recipt', () => {
  let testdata: any;
  let testblock: Block;
  let testTransactions: Transaction[];
  let testreceipts: Receipt[];

  before(() => {
    const common = Common.createChainStartCommon('gxc2-testnet');
    testdata = JSON.parse(fs.readFileSync(path.join(__dirname, '/test-data.json')).toString());
    testblock = Block.fromBlockData(testdata, { common, hardforkByBlockNumber: true });
    testTransactions = testdata.transactions.map((r) => {
      return Transaction.fromTxData(r);
    });
    let lastCumulativeGasUsed = new BN(0);
    testreceipts = (testdata.receipts as { cumulativeGasUsed: string; bitvector: string; logs: any[]; status: string }[]).map((r) => {
      const logs = (r.logs as { address: string; data: string; topics: string[] }[]).map((l) => {
        return new Log(
          hexStringToBuffer(l.address),
          l.topics.map((t) => {
            return hexStringToBuffer(t);
          }),
          hexStringToBuffer(l.data)
        );
      });
      return new Receipt(hexStringToBuffer(r.cumulativeGasUsed), hexStringToBuffer(r.bitvector), logs, hexStringToBN(r.status).toNumber() as 0 | 1);
    });
    testreceipts.forEach((r, i) => {
      const gasUsed = r.bnCumulativeGasUsed.sub(lastCumulativeGasUsed);
      r.installProperties(testblock, testTransactions[i], gasUsed, i);
    });
  });

  it('shoud fromRlpSerializedReceipt correctly', () => {
    const fromrlpReceipts: Receipt[] = testdata.receipts_serialize.map((r) => {
      return Receipt.fromRlpSerializedReceipt(hexStringToBuffer(r.serialize));
    });
    fromrlpReceipts.forEach((r, i) => {
      expect(r.serialize().equals(testreceipts[i].serialize()), 'receipt serialize should be equal').be.true;
      if (!testTransactions[i].to) {
        expect(r.contractAddress!.equals(generateAddress(testTransactions[i].getSenderAddress().buf, testTransactions[i].nonce.toArrayLike(Buffer))), 'receipt contractAddress should be equal').be.true;
      }
    });
  });

  it('shoud fromValuesArray correctly', () => {
    const fromValuesReceipts: Receipt[] = testdata.receipts_raw.map((r) => {
      const valuesArray: ReceiptRawValue = [hexStringToBuffer(r.status), hexStringToBuffer(r.cumulativeGasUsed), hexStringToBuffer(r.bitvector), r.rawLogs];
      return Receipt.fromValuesArray(valuesArray);
    });
    fromValuesReceipts.forEach((r, i) => {
      expect(r.serialize().equals(testreceipts[i].serialize()), 'receipt serialize should be equal').be.true;
      if (!testTransactions[i].to) {
        expect(r.contractAddress!.equals(generateAddress(testTransactions[i].getSenderAddress().buf, testTransactions[i].nonce.toArrayLike(Buffer))), 'receipt contractAddress should be equal').be.true;
      }
    });
  });

  it('should get raw', () => {
    testreceipts.forEach((r, i) => {
      const raw = r.raw();
      expect((raw[0] as Buffer).equals(hexStringToBuffer(testdata.receipts_raw[i].status)), 'status should be equal').be.true;
      expect((raw[1] as Buffer).equals(hexStringToBuffer(testdata.receipts_raw[i].cumulativeGasUsed)), 'cumulativeGasUsed should be equal').be.true;
      expect((raw[2] as Buffer).equals(hexStringToBuffer(testdata.receipts_raw[i].bitvector)), 'bitvector should be equal').be.true;
      raw[3].forEach((r, j) => {
        expect(r.equals(testdata.receipts_raw[i].rawLogs[j]), 'log member should be equal');
      });
    });
  });

  it('should get serialize', () => {
    testreceipts.forEach((r, i) => {
      const serialize = r.serialize();
      expect(serialize.equals(hexStringToBuffer(testdata.receipts_serialize[i].serialize)), 'serialized data should be equal').be.true;
    });
  });

  it('should convert to rpcjson', () => {
    const receipt1 = testreceipts[0].toRPCJSON();
    const testreceipt1 = testdata.receipts[0];
    expect(receipt1.blockHash, 'blockHash should be equal').be.equal(testreceipt1.blockHash);
    expect(receipt1.blockNumber, 'blockNumber should be equal').be.equal(testreceipt1.blockNumber);
    expect(receipt1.contractAddress, 'contractAddress should be equal').be.equal(testreceipt1.contractAddress);
    expect(receipt1.cumulativeGasUsed, 'cumulativeGasUsed should be equal').be.equal(testreceipt1.cumulativeGasUsed);
    expect(receipt1.from, 'from should be equal').be.equal(testreceipt1.from);
    receipt1.logs.forEach((r, i) => {
      expect(r, 'logs should be equal').be.equal(testreceipt1.logs[i]);
    });
    expect(receipt1.gasUsed, 'gasUsed should be equal').be.equal(testreceipt1.gasUsed);
    expect(receipt1.logsBloom, 'logsBloom should be equal').be.equal(testreceipt1.bitvector);
    expect(receipt1.status, 'status should be equal').be.equal(testreceipt1.status);
    expect(receipt1.to, 'to should be equal').be.equal(testreceipt1.to);
    expect(receipt1.transactionHash, 'transactionHash should be equal').be.equal(testreceipt1.transactionHash);
    expect(receipt1.transactionIndex, 'transactionIndex should be equal').be.equal(testreceipt1.transactionIndex);
  });
});
