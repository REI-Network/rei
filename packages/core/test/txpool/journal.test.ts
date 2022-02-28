import fs from 'fs';
import path from 'path';
import { Common } from '@rei-network/common';
import { Journal } from '../../src/txpool/journal';
import { Transaction } from '@rei-network/structure';
import { expect } from 'chai';
import { FunctionalBufferMap, hexStringToBuffer, setLevel } from '@rei-network/utils';

setLevel('silent');
class MockNode {
  getCommon(num: number) {
    const common = new Common({ chain: 'rei-testnet' });
    common.setHardforkByBlockNumber(0);
    return common;
  }
}

describe('Journal', () => {
  let testdir: string;
  let journal: Journal;
  let testdata: any;
  const node = new MockNode();
  const testTransactions: Transaction[] = [];
  before(async () => {
    testdata = JSON.parse(fs.readFileSync(path.join(__dirname, '/test-data.json')).toString());
    testdata.transactions.forEach((element) => {
      testTransactions.push(Transaction.fromTxData(element));
    });
    testdir = path.join(__dirname, '/test-dir');
    if (!fs.existsSync(testdir)) {
      fs.mkdirSync(testdir, { recursive: true });
    }
    journal = new Journal(testdir, node as any);
    testTransactions.forEach(async (trx) => {
      await journal.insert(trx);
    });
  });

  it('should load correctly', async () => {
    await journal.load(async (trxs: Transaction[]) => {
      trxs.forEach((trx, i) => {
        expect(trx.serialize().equals(testTransactions[i].serialize()), 'transaction should be equal').be.true;
      });
    });
  });

  it('should insert correctly', async () => {
    const another = Transaction.fromTxData(testdata.another);
    await journal.insert(another);
    await journal.load(async (trxs: Transaction[]) => {
      expect(trxs[4].serialize().equals(another.serialize()), 'transaction should be equal').be.true;
    });
  });

  it('should rotate correctly', async () => {
    const addr = hexStringToBuffer('0x2dd3cf3116858021c7a234ff470b21a8d3e547d4');
    const remap = new FunctionalBufferMap<Transaction[]>();
    remap.set(addr, testTransactions);
    await journal.rotate(remap);
    await journal.load(async (trxs: Transaction[]) => {
      trxs.forEach((trx, i) => {
        expect(trx.serialize().equals(testTransactions[i].serialize()), 'transaction should be equal').be.true;
      });
      expect(trxs.length, 'transaction should be rotated').be.equal(4);
    });
  });

  after(async () => {
    fs.rmdirSync(testdir, { recursive: true });
  });
});
