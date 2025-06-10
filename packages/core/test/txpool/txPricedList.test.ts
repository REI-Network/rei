import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { Transaction } from '@rei-network/structure';
import { hexStringToBN, FunctionalBufferMap } from '@rei-network/utils';
import { TxPricedList } from '../../src/txpool/txPricedList';

describe('TxPricedList', () => {
  let txList: TxPricedList;
  let testdata: any;
  let testTransactions: Transaction[] = [];
  let another: Transaction;
  const trxmap = new FunctionalBufferMap<Transaction>();

  before(() => {
    testdata = JSON.parse(
      fs.readFileSync(path.join(__dirname, '/test-data.json')).toString()
    );
    testdata.transactions.forEach((trx) => {
      testTransactions.push(Transaction.fromTxData(trx));
      trxmap.set(
        Transaction.fromTxData(trx).hash(),
        Transaction.fromTxData(trx)
      );
    });
    another = Transaction.fromTxData(testdata.another);
    trxmap.set(another.hash(), another);
    txList = new TxPricedList(trxmap);
  });

  it('should put correctly', () => {
    txList.put(another, false);
    expect(
      txList.remotes.peek().serialize().equals(another.serialize()),
      'transaction should be euqal'
    ).be.true;
  });

  it('should reheap correctly', () => {
    txList.reheap();
    expect(txList.stales, 'stales should be 0').be.equal(0);
  });

  it('should removed correctly', () => {
    txList.stales++;
    expect(txList.stales, 'stales should be equal').be.equal(1);
    txList.removed(1);
    expect(txList.stales, 'stales should be equal').be.equal(0);
  });

  it('should cap correctly', () => {
    const drop = txList.cap(hexStringToBN('0x3b9aca01')).map((trx) => {
      return trx.hash();
    });
    const testTransactions1 = [...testTransactions].map((trx) => {
      return trx.hash();
    });
    drop.sort();
    testTransactions1.sort();
    drop.forEach((hash, i) => {
      expect(hash.equals(testTransactions1[i]), 'hash should be equal').be.true;
    });
  });

  it('should underpriced correctly', () => {
    expect(txList.underpriced(another), 'should be false').be.false;
  });

  it('should discard correctly', () => {
    txList.reheap();
    const result = txList.discard(5, true);
    const trx1 = result[0]!
      .map((trx) => {
        return trx.hash();
      })
      .sort();

    testTransactions.push(another);
    const test1 = testTransactions
      .map((trx) => {
        return trx.hash();
      })
      .sort();
    trx1.forEach((trx, i) => {
      expect(trx.equals(test1[i]), 'transaction should be equal').be.equal;
    });
  });
});
