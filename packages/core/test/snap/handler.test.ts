import { expect } from 'chai';
import { BN, keccak256 } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { Database } from '@rei-network/database';
import { SnapTree } from '../../src/snap/snapTree';
import { AccountInfo, genRandomAccounts } from './util';
import { DiskLayer } from '../../src/snap/diskLayer';
import * as s from '../../src/consensus/reimint/snapMessages';
import { SnapProtocolHandler } from '../../src/protocols/snap';

class MockNode {
  snaptree: SnapTree;
  public latestBlock: { header: { number: BN } } = { header: { number: new BN(1) } };
  public db: { getSnapRecoveryNumber: any } = { getSnapRecoveryNumber: async () => new BN(0) };

  constructor(db: Database, root: Buffer) {
    this.db = db;
    this.snaptree = new SnapTree(db, snapTreeCache, this as any);
  }
}

class Mockpool {
  data: SnapProtocolHandler[] = [];
  add(handler: SnapProtocolHandler) {
    this.data.push(handler);
  }
  has(handler: SnapProtocolHandler) {
    return this.data.includes(handler);
  }
  remove(handler: SnapProtocolHandler) {
    this.data.splice(this.data.indexOf(handler), 1);
  }
}

class MockProctocol {
  public name: string;
  public node: any;
  public pool: Mockpool = new Mockpool();

  constructor(name: string, node: any) {
    this.name = name;
    this.node = node;
  }
}

class MockPeer {
  public callback: ((data: Buffer) => void) | undefined = undefined;

  public send(name: string, data: Buffer) {
    if (this.callback) {
      this.callback(data);
    }
  }

  isSupport(protocol: string) {
    return true;
  }
}

class MockHander extends SnapProtocolHandler {
  getWaitingRequests() {
    return this.waitingRequests;
  }
}

const level = require('level-mem');
const snapTreeCache = 100;
const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);
const db = new Database(level(), common);
const count = 10;
let root: Buffer;
let accounts: AccountInfo[];
let lastestAccountHash: Buffer;
const protocolname = 'snap protocol';
let handler: MockHander;
let reqid = 0;

describe('snap protocol handler', function () {
  before(async () => {
    const genRandResult = await genRandomAccounts(db, count, count);
    root = genRandResult.root;
    accounts = genRandResult.accounts;
    lastestAccountHash = genRandResult.lastestAccountHash;
    const diskLayer = new DiskLayer(db, root);
    const node = new MockNode(db, root);
    await node.snaptree.init(root, true, true);
    const protocol = new MockProctocol(protocolname, node);
    const peer = new MockPeer();
    handler = new MockHander(protocol as any, peer as any);
  });

  it('should handshake with peer', async () => {
    expect(handler.handshake() === true, 'handshake should return true').to.be.true;
  });

  it('should getAccountRange correctly', async () => {
    const requestRoot = root;
    const startHash = accounts[0].accountHash;
    const limitHash = accounts[accounts.length - 1].accountHash;
    const responseLimit = 1024;
    const resolveMessage = 'account resolve message';
    const callback = (data: Buffer) => {
      const msgInstance = s.SnapMessageFactory.fromSerializedMessage(data) as s.GetAccountRange;
      expect(msgInstance.reqID === reqid, 'reqID should be equal').to.be.true;
      expect(msgInstance.rootHash.equals(requestRoot), 'requestRoot should be equal').to.be.true;
      expect(msgInstance.startHash.equals(startHash), 'startHash should be equal').to.be.true;
      expect(msgInstance.limitHash.equals(limitHash), 'limitHash should be equal').to.be.true;
      expect(msgInstance.responseLimit === responseLimit, 'responseLimit should be equal').to.be.true;
      const waitingRequests = handler.getWaitingRequests();
      expect(waitingRequests.size === 1, 'waitingRequests should have one request').to.be.true;
      const request = waitingRequests.get(msgInstance.reqID);
      if (request) {
        clearTimeout(request.timeout);
        waitingRequests.delete(msgInstance.reqID);
        request.resolve(resolveMessage);
      }
    };
    (handler.peer as any as MockPeer).callback = callback;
    const response = await handler.getAccountRange(requestRoot, startHash, limitHash, responseLimit);
    expect(response === resolveMessage, 'response should be equal').to.be.true;
    reqid++;
  });

  it('should getStorageRange correctly', async () => {
    const requestRoot = root;
    const accountHashes = [...accounts].map((account) => account.accountHash);
    const hashKeys = Array.from(accounts[0].storageData.keys());
    const startHash = hashKeys[0];
    const limitHash = hashKeys[hashKeys.length - 1];
    const responseLimit = 1024;
    const resolveMessage = 'storage resolve message';
    const callback = (data: Buffer) => {
      const msgInstance = s.SnapMessageFactory.fromSerializedMessage(data) as s.GetStorageRange;
      expect(msgInstance.reqID === reqid, 'reqID should be equal').to.be.true;
      expect(msgInstance.rootHash.equals(requestRoot), 'requestRoot should be equal').to.be.true;
      for (let i = 0; i < accountHashes.length; i++) {
        expect(msgInstance.accountHashes[i].equals(accountHashes[i]), 'accountHashes should be equal').to.be.true;
      }
      expect(msgInstance.startHash.equals(startHash), 'startHash should be equal').to.be.true;
      expect(msgInstance.limitHash.equals(limitHash), 'limitHash should be equal').to.be.true;
      expect(msgInstance.responseLimit === responseLimit, 'responseLimit should be equal').to.be.true;
      const waitingRequests = handler.getWaitingRequests();
      expect(waitingRequests.size === 1, 'waitingRequests should have one request').to.be.true;
      const request = waitingRequests.get(msgInstance.reqID);
      if (request) {
        clearTimeout(request.timeout);
        waitingRequests.delete(msgInstance.reqID);
        request.resolve(resolveMessage);
      }
    };
    (handler.peer as any as MockPeer).callback = callback;
    const response = await handler.getStorageRange(requestRoot, accountHashes, startHash, limitHash, responseLimit);
    expect(response === resolveMessage, 'response should be equal').to.be.true;
    reqid++;
  });

  it('should getByteCode correctly', async () => {
    const codeHashes = [...accounts].map((account) => keccak256(account.code));
    const responseLimit = 1024;
    const resolveMessage = 'ByteCode resolve message';
    const callback = (data: Buffer) => {
      const msgInstance = s.SnapMessageFactory.fromSerializedMessage(data) as s.GetByteCode;
      expect(msgInstance.reqID === reqid, 'reqID should be equal').to.be.true;
      expect(msgInstance.responseLimit === responseLimit, 'responseLimit should be equal').to.be.true;
      for (let i = 0; i < codeHashes.length; i++) {
        expect(msgInstance.hashes[i].equals(codeHashes[i]), 'codeHashes should be equal').to.be.true;
      }
      const waitingRequests = handler.getWaitingRequests();
      expect(waitingRequests.size === 1, 'waitingRequests should have one request').to.be.true;
      const request = waitingRequests.get(msgInstance.reqID);
      if (request) {
        clearTimeout(request.timeout);
        waitingRequests.delete(msgInstance.reqID);
        request.resolve(resolveMessage);
      }
    };
    (handler.peer as any as MockPeer).callback = callback;
    const response = await handler.getByteCode(codeHashes, responseLimit);
    expect(response === resolveMessage, 'response should be equal').to.be.true;
    reqid++;
  });

  it('should getTrieNode correctly', async () => {
    const requestRoot = root;
    const paths: Buffer[][] = [];
    for (const account of accounts) {
      paths.push([account.accountHash, ...account.storageData.keys()]);
    }
    const responseLimit = 1024;
    const resolveMessage = 'TrieNode resolve message';
    const callback = (data: Buffer) => {
      const msgInstance = s.SnapMessageFactory.fromSerializedMessage(data) as s.GetTrieNode;
      expect(msgInstance.reqID === reqid, 'reqID should be equal').to.be.true;
      expect(msgInstance.responseLimit === responseLimit, 'responseLimit should be equal').to.be.true;
      for (let i = 0; i < paths.length; i++) {
        for (let j = 0; j < paths[i].length; j++) {
          expect(msgInstance.paths[i][j].equals(paths[i][j]), 'paths should be equal').to.be.true;
        }
      }

      const waitingRequests = handler.getWaitingRequests();
      expect(waitingRequests.size === 1, 'waitingRequests should have one request').to.be.true;
      const request = waitingRequests.get(msgInstance.reqID);
      if (request) {
        clearTimeout(request.timeout);
        waitingRequests.delete(msgInstance.reqID);
        request.resolve(resolveMessage);
      }
    };
    (handler.peer as any as MockPeer).callback = callback;
    const response = await handler.getTrieNode(requestRoot, paths, responseLimit);
    expect(response === resolveMessage, 'response should be equal').to.be.true;
    reqid++;
  });
});
