import { WsClient } from '../../src/client';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { BlockHeader, Transaction, Log } from '@gxchain2/structure';
import { hexStringToBuffer } from '@gxchain2/utils';
import { SyncingStatus, JSONRPC_VERSION } from '../../src/types';

class testclass {
  data: any[] = [];
  send(data: any) {
    this.data.push(data);
  }
  reset() {
    this.data = [];
  }
}

describe('WsClient', () => {
  let testdata: any;
  let wsclient: WsClient;
  let testWebsocket: testclass;
  const testBlockHeaders: BlockHeader[] = [];
  const testlogs: Log[] = [];
  const testTransactions: Transaction[] = [];
  const message = 'this is a message';
  const subscription = '12580';
  const method = 'eth_subscription';
  const status: SyncingStatus = { syncing: true, status: { startingBlock: '10086', currentBlock: '12358', highestBlock: '12377' } };

  before(() => {
    testdata = JSON.parse(fs.readFileSync(path.join(__dirname, '/test-data.json')).toString());
    testWebsocket = new testclass();
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
  });

  it('should send message', () => {
    testWebsocket.reset();
    wsclient.send(message);
    expect(JSON.parse(testWebsocket.data[0]), 'message should be equal').be.equal(message);
  });

  it('should notifyHeader correctly', () => {
    testWebsocket.reset();
    wsclient.notifyHeader(subscription, testBlockHeaders);
    testWebsocket.data.forEach((r, i) => {
      const data = JSON.parse(r);
      expect(data.jsonrpc, 'jsonrpc should be equal').be.equal(JSONRPC_VERSION);
      expect(data.method, 'method should be equal').be.equal(method);
      expect(data.params.subscription, 'subscription should be equal').be.equal(subscription);
      const recoverHeader = BlockHeader.fromHeaderData(data.params.result);
      expect(recoverHeader.serialize().equals(testBlockHeaders[i].serialize()), 'serialized data should be equal').be, true;
    });
  });

  it('should notifyLogs correctly', () => {
    testWebsocket.reset();
    wsclient.notifyLogs(subscription, testlogs);
    testWebsocket.data.forEach((r, i) => {
      const data = JSON.parse(r);
      const result = data.params.result;
      expect(data.jsonrpc, 'jsonrpc should be equal').be.equal(JSONRPC_VERSION);
      expect(data.method, 'method should be equal').be.equal(method);
      expect(data.params.subscription, 'subscription should be equal').be.equal(subscription);
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

  it('should notifyPendingTransactions correctly', () => {
    testWebsocket.reset();
    const hasharray = testTransactions.map((r) => {
      return r.hash();
    });
    wsclient.notifyPendingTransactions(subscription, hasharray);
    testWebsocket.data.forEach((r, i) => {
      const data = JSON.parse(r);
      expect(data.jsonrpc, 'jsonrpc should be equal').be.equal(JSONRPC_VERSION);
      expect(data.method, 'method should be equal').be.equal(method);
      expect(data.params.subscription, 'subscription should be equal').be.equal(subscription);
      expect(hexStringToBuffer(data.params.result).equals(hasharray[i]), 'result should be equal').be.true;
    });
  });

  it('should notifySyncing correctly', () => {
    testWebsocket.reset();
    wsclient.notifySyncing(subscription, status);
    const data = JSON.parse(testWebsocket.data[0]);
    expect(data.jsonrpc, 'jsonrpc should be equal').be.equal(JSONRPC_VERSION);
    expect(data.method, 'method should be equal').be.equal(method);
    expect(data.params.subscription, 'subscription should be equal').be.equal(subscription);
    expect(data.params.result.syncing, 'syning should be true').be.true;
    expect(data.params.result.status.startingBlock, 'startingBlock should be equal').be.equal(status.status.startingBlock);
    expect(data.params.result.status.currentBlock, 'currentBlock should be equal').be.equal(status.status.currentBlock);
    expect(data.params.result.status.highestBlock, 'highestBlock should be equal').be.equal(status.status.highestBlock);
  });

  it('should close correctly', () => {
    expect(wsclient.isClosed, 'should not be closed').be.false;
    wsclient.close();
    expect(wsclient.isClosed, 'should be closed').be.true;
  });
});
