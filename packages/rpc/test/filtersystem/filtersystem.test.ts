import { FilterSystem } from '../../src/filtersystem';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { Address } from 'ethereumjs-util';
import { EventEmitter } from 'events';
import { Transaction, BlockHeader, Log } from '@gxchain2/structure';
import { WsClient } from '../../src/client';
import { hexStringToBuffer } from '@gxchain2/utils';

class testclass {
  data: any[] = [];
  send(data: any) {
    this.data.push(data);
  }
  reset() {
    this.data = [];
  }
}

declare interface testbcMonitor {
  on(event: 'logs' | 'removedLogs', listener: (logs: Log[]) => void): this;
  on(event: 'newHeads', listener: (hashes: Buffer[]) => void): this;
}
class testbcMonitor extends EventEmitter {}

declare interface testSynchronizer {
  on(event: 'start', listener: () => void): this;
  on(event: 'synchronized', listener: () => void): this;
  on(event: 'failed', listener: () => void): this;
}
class testSynchronizer extends EventEmitter {
  status = { startingBlock: 1000, highestBlock: 2000 };
}

declare interface testTxPool {
  on(event: 'readies', listener: (readies: Transaction[]) => void): this;
}
class testTxPool extends EventEmitter {}
class testnode {
  bcMonitor: testbcMonitor;
  sync: testSynchronizer;
  txPool: testTxPool;
  headers: BlockHeader[];
  headerhashes: Buffer[];
  blockchain = { latestBlock: { header: { number: 1001 } } };
  db = {
    tryToGetCanonicalHeader: (hash: Buffer) => {
      const index = this.headerhashes.indexOf(hash);
      return this.headers[index];
    }
  };
  constructor(bc: testbcMonitor, sync: testSynchronizer, txpool: testTxPool, headers: BlockHeader[]) {
    this.bcMonitor = bc;
    this.sync = sync;
    this.txPool = txpool;
    this.headers = headers;
    this.headerhashes = this.headers.map((head) => {
      return head.hash();
    });
  }
}

describe('FilterSystem', () => {
  let node: testnode;
  let filtersystem: FilterSystem;
  let wsclient: WsClient;
  let testWebsocket: testclass = new testclass();
  let subSyncUid: string;
  let filterLogUid: string;
  let testdata: any;
  const testBlockHeaders: BlockHeader[] = [];
  const testlogs: Log[] = [];
  const testTransactions: Transaction[] = [];
  const bcMonitor = new testbcMonitor();
  const sync = new testSynchronizer();
  const txPool = new testTxPool();
  const addresses1 = [Address.fromString('0x7db395ed6d3d7b191bcb33f82d9a336d71a4b4cd')];
  const topics1 = [hexStringToBuffer('0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65')];

  before(async () => {
    testdata = JSON.parse(fs.readFileSync(path.join(__dirname, '/test-data.json')).toString());
    wsclient = new WsClient(testWebsocket as any);
    testdata.headers.forEach((r) => {
      testBlockHeaders.push(BlockHeader.fromHeaderData(r));
    });
    testdata.pendingTransactions.forEach((r) => {
      testTransactions.push(Transaction.fromTxData(r));
    });
    testdata.logs.forEach((r) => {
      testlogs.push(
        new Log(
          hexStringToBuffer(r.address),
          r.topics.map((t) => {
            return hexStringToBuffer(t);
          }),
          hexStringToBuffer(r.data)
        )
      );
    });
    node = new testnode(bcMonitor, sync, txPool, testBlockHeaders);
    filtersystem = new FilterSystem(node as any);
  });

  it('should subscribe newHeads correctly', async () => {
    testWebsocket.reset();
    const subHeadUid = filtersystem.subscribe(wsclient, 'newHeads');
    bcMonitor.emit('newHeads', node.headerhashes);
    await new Promise<void>((r) => {
      setTimeout(r);
    });
    testWebsocket.data.forEach((r, i) => {
      const data = JSON.parse(r);
      expect(data.params.subscription, 'uid should be equal').be.equal(subHeadUid);
      const recoverHeader = BlockHeader.fromHeaderData(data.params.result);
      expect(recoverHeader.serialize().equals(testBlockHeaders[i].serialize()), 'serialized data should be equal').be, true;
    });
  });

  it('should subscribe logs correctly', async () => {
    testWebsocket.reset();
    const query = { addresses: [], topics: [] };
    const subLogsUid = filtersystem.subscribe(wsclient, 'logs', query);
    bcMonitor.emit('logs', testlogs);
    await new Promise<void>((r) => {
      setTimeout(r);
    });
    testWebsocket.data.forEach((r, i) => {
      const data = JSON.parse(r);
      const result = data.params.result;
      expect(data.params.subscription, 'subscription should be equal').be.equal(subLogsUid);
      const recoverLog = Log.fromValuesArray([
        hexStringToBuffer(result.address),
        result.topics.map((r) => {
          return hexStringToBuffer(r);
        }),
        hexStringToBuffer(result.data)
      ]);
      expect(recoverLog.serialize().equals(testlogs[i].serialize()), 'serialized data should be equal').be.true;
    });
  });

  it('should subscribe newPendingTransactions correctly', async () => {
    testWebsocket.reset();
    const subPendingUid = filtersystem.subscribe(wsclient, 'newPendingTransactions');
    const hasharray = testTransactions.map((r) => {
      return r.hash();
    });
    txPool.emit('readies', testTransactions);
    await new Promise<void>((r) => {
      setTimeout(r);
    });
    testWebsocket.data.forEach((r, i) => {
      const data = JSON.parse(r);
      expect(data.params.subscription, 'subscription should be equal').be.equal(subPendingUid);
      expect(hexStringToBuffer(data.params.result).equals(hasharray[i]), 'result should be equal').be.true;
    });
  });

  it('should subscribe syncing correctly', async () => {
    testWebsocket.reset();
    subSyncUid = filtersystem.subscribe(wsclient, 'syncing');
    sync.emit('failed');
    await new Promise<void>((r) => {
      setTimeout(r);
    });
    expect(JSON.parse(testWebsocket.data[0]).params.subscription, 'uid should be equal').be.equal(subSyncUid);
    expect(JSON.parse(testWebsocket.data[0]).params.result, 'syncing status should be equal').be.equal(false);
  });

  it('should unsubscribe correctly', () => {
    const result = filtersystem.unsubscribe(subSyncUid);
    expect(result, 'should unsubscribe correctly').be.true;
  });

  it('should newFilter newHeads correctly', async () => {
    const filterHeadUid = filtersystem.newFilter('newHeads');
    bcMonitor.emit('newHeads', node.headerhashes);
    await new Promise<void>((r) => {
      setTimeout(r);
    });
    const blockhashes = filtersystem.filterChanges(filterHeadUid);
    blockhashes!.forEach((hash, i) => {
      expect(hash.equals(node.headerhashes[i]), 'blockheader hash should be equal').be.true;
    });
  });

  it('should newFilter logs correctly', async () => {
    const query = { addresses: addresses1, topics: topics1 };
    filterLogUid = filtersystem.newFilter('logs', query);
    bcMonitor.emit('logs', testlogs);
    await new Promise<void>((r) => {
      setTimeout(r);
    });
    const logs = filtersystem.filterChanges(filterLogUid)!;
    expect((logs[0] as Log).serialize().equals(testlogs[0].serialize()), 'serialized data should be equal').be.true;
  });

  it('should newFilter newPendingTransactions correctly', async () => {
    const filterPendingUid = filtersystem.newFilter('newPendingTransactions');
    const hasharray = testTransactions.map((r) => {
      return r.hash();
    });
    txPool.emit('readies', testTransactions);
    await new Promise<void>((r) => {
      setTimeout(r);
    });
    const result = filtersystem.filterChanges(filterPendingUid)!;
    result.forEach((hash, i) => {
      expect(hash.equals(hasharray[i]), 'PendingTransaction hash should be equal').be.true;
    });
  });

  it('should getFilterQuery correctly', () => {
    const result = filtersystem.getFilterQuery(filterLogUid)!;
    result.addresses.forEach((address, i) => {
      expect(address.equals(addresses1[i]), 'Query addresses should be equal');
    });
    result.topics.forEach((topic, i) => {
      expect((topic as Buffer).equals(topics1[i]), 'Query topics should be equal').be.true;
    });
  });

  it('should uninstall correctly', () => {
    const result = filtersystem.uninstall(filterLogUid);
    expect(result, 'should uninstall correctly').be.true;
  });

  after(async () => {
    await filtersystem.abort();
  });
});
