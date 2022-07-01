import { expect } from 'chai';
import { BN, keccak256 } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { Database } from '@rei-network/database';
import { AccountInfo, genRandomAccounts } from './util';
import { SnapTree } from '../../src/snap/snapTree';
import * as s from '../../src/consensus/reimint/snapMessages';
import { SnapProtocolHandler } from '../../src/protocols/snap';
import { BaseTrie } from 'merkle-patricia-tree';
import { EMPTY_HASH, MAX_HASH } from '../../src/utils';
import { TrieNodeIterator } from '../../src/snap/trieIterator';

class MockNode {
  snaptree: SnapTree;
  public latestBlock: { header: { number: BN } } = { header: { number: new BN(1) } };
  public db: { getSnapRecoveryNumber: any } = { getSnapRecoveryNumber: async () => new BN(0) };

  constructor(db: Database) {
    this.db = db;
    this.snaptree = new SnapTree(db, this as any);
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
const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);
const db = new Database(level(), common);
const count = 10;
let root: Buffer;
let accounts: AccountInfo[];
const protocolname = 'snap protocol';
let handler: MockHander;
let reqid = 0;

describe('snap protocol handler', function () {
  before(async () => {
    const genRandResult = await genRandomAccounts(db, count, count);
    root = genRandResult.root;
    accounts = genRandResult.accounts;
    const node = new MockNode(db);
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
    let sortAccounts = accounts.sort((a, b) => a.accountHash.compare(b.accountHash));
    const startHash = sortAccounts[0].accountHash;
    const limitHash = sortAccounts[sortAccounts.length - 2].accountHash;
    sortAccounts = sortAccounts.slice(0, sortAccounts.length - 1);
    const responseLimit = 1024 * 1024;
    const accountData = sortAccounts.map((account) => [account.accountHash, account.account.serialize()]);
    let resolveData: Buffer;
    const msg = new s.GetAccountRange(reqid, requestRoot, startHash, limitHash, responseLimit);
    const callback1 = (data: Buffer) => {
      resolveData = data;
      const msgInstance = s.SnapMessageFactory.fromSerializedMessage(data) as s.AccountRange;
      expect(msgInstance.reqID === reqid, 'reqID should be equal').to.be.true;
      for (let i = 0; i < msgInstance.accountData.length; i++) {
        expect(msgInstance.accountData[i][0].equals(accountData[i][0]), 'accountHashes should be equal').to.be.true;
        expect(msgInstance.accountData[i][1].equals(accountData[i][1]), 'accountBody should be equal').to.be.true;
      }
    };

    (handler.peer as any as MockPeer).callback = callback1;
    const data = s.SnapMessageFactory.serializeMessage(msg);
    await handler.handle(data);

    const callback2 = (data: Buffer) => {
      const msgInstance = s.SnapMessageFactory.fromSerializedMessage(data) as s.GetAccountRange;
      expect(msgInstance.reqID === reqid, 'reqID should be equal').to.be.true;
      expect(msgInstance.rootHash.equals(requestRoot), 'requestRoot should be equal').to.be.true;
      expect(msgInstance.startHash.equals(startHash), 'startHash should be equal').to.be.true;
      expect(msgInstance.limitHash.equals(limitHash), 'limitHash should be equal').to.be.true;
      const waitingRequests = handler.getWaitingRequests();
      expect(waitingRequests.size === 1, 'waitingRequests should have one request').to.be.true;
      const request = waitingRequests.get(msgInstance.reqID);
      if (request) {
        clearTimeout(request.timeout);
        waitingRequests.delete(msgInstance.reqID);
        request.resolve(resolveData);
      }
    };
    (handler.peer as any as MockPeer).callback = callback2;
    const response = await handler.getAccountRange(requestRoot, { origin: startHash, limit: limitHash });
    if (response) {
      for (let i = 0; i < response.accounts.length; i++) {
        expect(response.hashes[i].equals(accountData[i][0]), 'accountHashes should be equal').to.be.true;
        expect(response.accounts[i].slimSerialize().equals(accountData[i][1]), 'accountBody should be equal').to.be.true;
      }
    }
    reqid++;
  });

  it('should getStorageRange correctly', async () => {
    const requestRoot = root;
    const accountHashes = accounts.map((account) => account.accountHash);
    const startHash = EMPTY_HASH;
    const limitHash = MAX_HASH;
    const responseLimit = 1024 * 1024;
    const msg = new s.GetStorageRange(reqid, requestRoot, accountHashes, startHash, limitHash, responseLimit);
    const storageHash = accounts.map((account) => Array.from(account.storageData.keys()).map((key) => key));
    const stotageData = accounts.map((account) => Array.from(account.storageData.values()).map((value) => value.val));
    let resolveData: Buffer;

    const callback1 = (data: Buffer) => {
      resolveData = data;
      const msgInstance = s.SnapMessageFactory.fromSerializedMessage(data) as s.StorageRange;
      expect(msgInstance.reqID === reqid, 'reqID should be equal').to.be.true;
      const storageData = accounts.map((account) => Array.from(account.storageData.keys()).map((key) => [key, account.storageData.get(key)!.val]));
      for (let i = 0; i < msgInstance.slots.length; i++) {
        for (let j = 0; j < msgInstance.slots[i].length; j++) {
          expect(msgInstance.slots[i][j][0].equals(storageData[i][j][0]), 'storageHash should be equal').to.be.true;
          expect(msgInstance.slots[i][j][1].equals(storageData[i][j][1]), 'storageData should be equal').to.be.true;
        }
      }
    };
    (handler.peer as any as MockPeer).callback = callback1;
    const data = s.SnapMessageFactory.serializeMessage(msg);
    await handler.handle(data);

    const callback2 = (data: Buffer) => {
      const msgInstance = s.SnapMessageFactory.fromSerializedMessage(data) as s.GetStorageRange;
      expect(msgInstance.reqID === reqid, 'reqID should be equal').to.be.true;
      expect(msgInstance.rootHash.equals(requestRoot), 'requestRoot should be equal').to.be.true;
      for (let i = 0; i < accountHashes.length; i++) {
        expect(msgInstance.accountHashes[i].equals(accountHashes[i]), 'accountHashes should be equal').to.be.true;
      }
      expect(msgInstance.startHash.equals(startHash), 'startHash should be equal').to.be.true;
      expect(msgInstance.limitHash.equals(limitHash), 'limitHash should be equal').to.be.true;
      const waitingRequests = handler.getWaitingRequests();
      expect(waitingRequests.size === 1, 'waitingRequests should have one request').to.be.true;
      const request = waitingRequests.get(msgInstance.reqID);
      if (request) {
        clearTimeout(request.timeout);
        waitingRequests.delete(msgInstance.reqID);
        request.resolve(resolveData);
      }
    };
    (handler.peer as any as MockPeer).callback = callback2;
    const response = await handler.getStorageRange(requestRoot, { accounts: accountHashes, roots: [], origin: startHash, limit: limitHash });
    if (response) {
      for (let i = 0; i < response.hashes.length; i++) {
        for (let j = 0; j < response.slots[i].length; j++) {
          expect(response.hashes[i][j].equals(storageHash[i][j]), 'accountHashes should be equal').to.be.true;
          expect(response.slots[i][j].equals(stotageData[i][j]), 'storageData should be equal').to.be.true;
        }
      }
    }
    reqid++;
  });

  it('should getByteCode  and handleGetByteCode correctly', async () => {
    const codeHashes = accounts.map((account) => keccak256(account.code));
    const responseLimit = 1024;
    const msg = new s.GetByteCode(reqid, codeHashes, responseLimit);
    const code = accounts.map((account) => account.code);
    let resolveData: Buffer;

    const callback1 = (data: Buffer) => {
      resolveData = data;
      const msgInstance = s.SnapMessageFactory.fromSerializedMessage(data) as s.ByteCode;
      for (let i = 0; i < msgInstance.codes.length; i++) {
        expect(msgInstance.codes[i].equals(code[i]), 'codes should be equal').to.be.true;
      }
    };
    (handler.peer as any as MockPeer).callback = callback1;
    const data = s.SnapMessageFactory.serializeMessage(msg);
    await handler.handle(data);

    const callback2 = (data: Buffer) => {
      const msgInstance = s.SnapMessageFactory.fromSerializedMessage(data) as s.GetByteCode;
      expect(msgInstance.reqID === reqid, 'reqID should be equal').to.be.true;
      for (let i = 0; i < codeHashes.length; i++) {
        expect(msgInstance.hashes[i].equals(codeHashes[i]), 'codeHashes should be equal').to.be.true;
      }
      const waitingRequests = handler.getWaitingRequests();
      expect(waitingRequests.size === 1, 'waitingRequests should have one request').to.be.true;
      const request = waitingRequests.get(msgInstance.reqID);
      if (request) {
        clearTimeout(request.timeout);
        waitingRequests.delete(msgInstance.reqID);
        request.resolve(resolveData);
      }
    };
    (handler.peer as any as MockPeer).callback = callback2;
    const response = await handler.getByteCode(codeHashes);
    if (response) {
      for (let i = 0; i < response.length; i++) {
        expect(response[i].equals(code[i]), 'codes should be equal').to.be.true;
      }
    }
    reqid++;
  });

  it('should getTrieNode correctly', async () => {
    const trie = new BaseTrie(handler.node.db.rawdb, root);
    const Interator = new TrieNodeIterator(trie);
    let i = 0;
    let keys: Buffer[] = [];
    let values: Buffer[] = [];
    for await (const node of Interator) {
      if (i > 5) {
        break;
      }
      keys.push(node.hash());
      values.push(node.serialize());
      i++;
    }

    const responseLimit = 1024;
    const msg1 = new s.GetTrieNode(reqid, keys, responseLimit);
    let resolveData: Buffer;

    const callback1 = (data: Buffer) => {
      resolveData = data;
      const msgInstance = s.SnapMessageFactory.fromSerializedMessage(data) as s.TrieNode;
      for (let i = 0; i < msgInstance.nodes.length; i++) {
        expect(msgInstance.nodes[i].equals(values[i]), 'nodes should be equal').to.be.true;
      }
    };
    (handler.peer as any as MockPeer).callback = callback1;
    const data1 = s.SnapMessageFactory.serializeMessage(msg1);
    await handler.handle(data1);

    const callback2 = (data: Buffer) => {
      const msgInstance = s.SnapMessageFactory.fromSerializedMessage(data) as s.GetTrieNode;
      expect(msgInstance.reqID === reqid, 'reqID should be equal').to.be.true;

      const waitingRequests = handler.getWaitingRequests();
      expect(waitingRequests.size === 1, 'waitingRequests should have one request').to.be.true;
      const request = waitingRequests.get(msgInstance.reqID);
      if (request) {
        clearTimeout(request.timeout);
        waitingRequests.delete(msgInstance.reqID);
        request.resolve(resolveData);
      }
    };
    (handler.peer as any as MockPeer).callback = callback2;
    const response = await handler.getTrieNode(keys);
    if (response) {
      for (let i = 0; i < response.length; i++) {
        expect(response[i].equals(values[i]), 'nodes should be equal').to.be.true;
      }
    }
    reqid++;
  });

  it('should abort correctly', async () => {
    expect((handler.protocol.pool as any as Mockpool).has(handler), 'handler should in the pool').to.be.true;
    handler.abort();
    expect((handler.protocol.pool as any as Mockpool).has(handler), 'handler should removed from the pool').to.be.false;
  });
});
