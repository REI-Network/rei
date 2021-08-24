import fs from 'fs';
import path from 'path';
import { Transaction } from '@gxchain2/structure';
import { PendingTxMap } from '../../../core/src/txpool';
import { hexStringToBuffer } from '@gxchain2/utils';
import { expect } from 'chai';

describe('PendingTxMap', () => {
  const testPendingTxMap = new PendingTxMap();
  let testdata: any;
  const testTransactions: Transaction[] = [];
  const sender = hexStringToBuffer('0x2dd3cf3116858021c7a234ff470b21a8d3e547d4');
  before(() => {
    testdata = JSON.parse(fs.readFileSync(path.join(__dirname, '/test-data.json')).toString());
    testdata.transactions.forEach((element) => {
      testTransactions.push(Transaction.fromTxData(element));
    });
  });

  it('should push and peek correctly', () => {
    testPendingTxMap.push(sender, testTransactions);
    const result = testPendingTxMap.peek()!;
    expect(result.serialize().equals(testTransactions[0].serialize()), 'transaction should be equal').be.true;
  });

  it('should shift correctly', () => {
    testPendingTxMap.shift();
    const result = testPendingTxMap.peek()!;
    expect(result.serialize().equals(testTransactions[1].serialize()), 'transaction should be equal').be.true;
  });

  it('should pop correctly', () => {
    testPendingTxMap.pop();
    const result = testPendingTxMap.peek()!;
    expect(result, 'should be undefined').be.equal(undefined);
  });
});
