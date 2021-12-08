import { RpcServer } from '../src/index';
import { expect } from 'chai';
import { EventEmitter } from 'events';
import { setLevel } from '@rei-network/utils';
import WebSocket from 'ws';
import axios from 'axios';

setLevel('silent');

class testbcMonitor extends EventEmitter {}
class testSynchronizer extends EventEmitter {}
class testTxPool extends EventEmitter {}
class testnode {
  bcMonitor: testbcMonitor;
  sync: testSynchronizer;
  txPool: testTxPool;
  constructor(bc: testbcMonitor, sync: testSynchronizer, txpool: testTxPool) {
    this.bcMonitor = bc;
    this.sync = sync;
    this.txPool = txpool;
  }
}
describe('Index', () => {
  let node: testnode;
  let rpcserver: RpcServer;
  const testurl = 'http://127.0.0.1:11451';
  const weburl = 'ws://localhost:11451';
  let testws: WebSocket;
  const bcMonitor = new testbcMonitor();
  const sync = new testSynchronizer();
  const txPool = new testTxPool();
  const wsDada: any[] = [];

  before(() => {
    node = new testnode(bcMonitor, sync, txPool);
    const serverOption = { node: node as any, apis: 'web3,net' };
    rpcserver = new RpcServer(serverOption);
    rpcserver.start();
    testws = new WebSocket(weburl);
    testws.on('message', (data) => {
      wsDada.push(data);
    });
  });

  it('http server should work ', async () => {
    const result1 = await axios({
      method: 'post',
      url: testurl,
      data: {
        jsonrpc: '2.0',
        method: 'web3_clientVersion',
        id: 1
      }
    });
    const result2 = await axios({
      method: 'post',
      url: testurl,
      data: {
        jsonrpc: '2.0',
        method: 'net_version',
        id: 1
      }
    });
    expect(result1.data.result, 'client version should be equal').equal('Mist/v0.0.1');
    expect(result2.data.result, 'net version should be equal').equal('77');
  });

  it('websocket server should work', async () => {
    const request1 = {
      jsonrpc: '2.0',
      method: 'web3_clientVersion',
      id: 1,
      params: []
    };
    const request2 = {
      jsonrpc: '2.0',
      method: 'net_version',
      id: 1,
      params: []
    };
    testws.send(JSON.stringify(request1));
    testws.send(JSON.stringify(request2));
    await new Promise<void>((r) => {
      setTimeout(r, 10);
    });
    expect(JSON.parse(wsDada[0]).result, 'client version should be equal').be.equal('Mist/v0.0.1');
    expect(JSON.parse(wsDada[1]).result, 'net version should be equal').be.equal('77');
  });
});
