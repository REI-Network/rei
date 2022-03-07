import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { Transaction } from '@rei-network/structure';
import { hexStringToBN } from '@rei-network/utils';
import { TxSortedMap } from '../../src/txpool/txmap';

describe('TxSortedMap', () => {
  let txSortedMap: TxSortedMap;
  let testdata: any;
  let testTransactions: Transaction[] = [];

  before(() => {
    testdata = JSON.parse(fs.readFileSync(path.join(__dirname, '/test-data.json')).toString());
    txSortedMap = new TxSortedMap(false);
    testdata.nonceSorted.forEach((trx) => {
      testTransactions.push(Transaction.fromTxData(trx));
    });
    testTransactions.forEach((trx) => {
      txSortedMap.push(trx, 10);
    });
  });

  it('should get size correctly', () => {
    expect(txSortedMap.size, 'size should be equal').be.equal(3);
  });

  it('should get slots correctly', () => {
    expect(txSortedMap.slots, 'slots should be equal').be.equal(3);
  });

  it('should has member', () => {
    const result = txSortedMap.has(hexStringToBN('0xf4'))!;
    expect(result, 'should be true').be.true;
  });

  it('should back correctly', () => {
    const result = txSortedMap.back(hexStringToBN('0xf4'));
    result.forEach((trx, i) => {
      expect(trx.serialize().equals(testTransactions[i].serialize()), 'transaction should be equal').be.true;
    });
  });

  it('should forward correctly', () => {
    testTransactions.forEach((trx) => {
      txSortedMap.push(trx, 10);
    });
    const result = txSortedMap.forward(hexStringToBN('0xf6'));
    result.forEach((trx, i) => {
      expect(trx.serialize().equals(testTransactions[i].serialize()), 'transaction should be equal').be.true;
    });
  });

  it('should resize correctly', () => {
    testTransactions.forEach((trx) => {
      txSortedMap.push(trx, 10);
    });
    const result = txSortedMap.resize(2);
    expect(result[0].serialize().equals(testTransactions[2].serialize()), 'transaction should be equal').be.true;
  });

  it('should delete correctly', () => {
    const { deleted, invalids } = txSortedMap.delete(hexStringToBN('0xf4'))!;
    expect(deleted, 'should be true').be.true;
  });

  it('should filter correctly', () => {
    txSortedMap.push(testTransactions[0], 10);
    txSortedMap.push(testTransactions[2], 10);
    const { removed, invalids } = txSortedMap.filter(hexStringToBN('0x5207'), hexStringToBN('0x5207'));
    removed.forEach((trx, i) => {
      expect(trx.serialize().equals(testTransactions[i].serialize()), 'transaction should be equal').be.true;
    });
  });

  it('should ready correctly', () => {
    testTransactions.forEach((trx) => {
      txSortedMap.push(trx, 10);
    });
    const readies = txSortedMap.ready(hexStringToBN('0xf4'));
    expect(readies[0].serialize().equals(testTransactions[0].serialize()), 'transaction should be true').be.true;
  });

  it('should clear correctly', () => {
    const results = txSortedMap.clear();
    results.forEach((trx, i) => {
      expect(trx.serialize().equals(testTransactions[i + 1].serialize()), 'transaction should be equal').be.true;
    });
    expect(txSortedMap.size, 'should be empty').be.equal(0);
  });

  it('should toList correctly', () => {
    testTransactions.forEach((trx) => {
      txSortedMap.push(trx, 10);
    });
    const result = txSortedMap.toList();
    result.forEach((trx, i) => {
      expect(trx.serialize().equals(testTransactions[i].serialize()), 'transaction should be equal').be.true;
    });
  });
});
