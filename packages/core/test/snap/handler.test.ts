import { expect } from 'chai';
import { BaseTrie as Trie } from 'merkle-patricia-tree';
import { BN, intToBuffer, keccak256, rlp, Account } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { Database } from '@rei-network/database';
import { AccountInfo, genRandomAccounts } from './util';
import { SnapTree } from '../../src/snap/snapTree';
import * as s from '../../src/consensus/reimint/snapMessages';
import { SnapProtocolHandler } from '../../src/protocols/snap';
import { StakingAccount } from '../../src/stateManager';
import { EMPTY_HASH, MAX_HASH } from '../../src/utils';

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
    const accountHashes = accounts.map((account) => account.accountHash);
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
    const codeHashes = accounts.map((account) => keccak256(account.code));
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

  it('should handleGetAccountRange correctly', async () => {
    const requestRoot = root;
    let sortAccounts = accounts.sort((a, b) => a.accountHash.compare(b.accountHash));
    const startHash = sortAccounts[sortAccounts.length - 1].accountHash;
    const limitHash = startHash;
    sortAccounts = [sortAccounts[sortAccounts.length - 1]];
    const responseLimit = 1024 * 1024;
    let proof: Buffer[] = [];
    let keys: Buffer[] = [];
    let values: Buffer[] = [];
    const accountData = sortAccounts.map((account) => [account.accountHash, account.account.serialize()]);
    const msg = new s.GetAccountRange(reqid, requestRoot, startHash, limitHash, responseLimit);
    const callback = (data: Buffer) => {
      const msgInstance = s.SnapMessageFactory.fromSerializedMessage(data) as s.AccountRange;
      expect(msgInstance.reqID === reqid, 'reqID should be equal').to.be.true;
      for (let i = 0; i < msgInstance.accountData.length; i++) {
        expect(msgInstance.accountData[i][0].equals(accountData[i][0]), 'accountHashes should be equal').to.be.true;
        expect(msgInstance.accountData[i][1].equals(accountData[i][1]), 'accountBody should be equal').to.be.true;
      }
      proof = msgInstance.proof;
      keys = msgInstance.accountData.map((account) => account[0]);
      values = msgInstance.accountData.map((account) => StakingAccount.fromRlpSlimSerializedAccount(account[1]).serialize());
    };

    (handler.peer as any as MockPeer).callback = callback;
    const data = rlp.encode([intToBuffer(s.GetAccountRange.code), msg.raw()]);
    await handler.handle(data);
    expect(await Trie.verifyRangeProof(requestRoot, startHash, limitHash, keys, values, proof), 'proof should be valid');
    reqid++;
  });

  it('should handleGetStorageRange correctly', async () => {
    const requestRoot = root;
    const sortAccounts = accounts.sort((a, b) => a.accountHash.compare(b.accountHash));
    const accountHashes = sortAccounts.map((account) => account.accountHash);
    const startHash = Array.from(sortAccounts[sortAccounts.length - 1].storageData.keys())[0];
    const limitHash = MAX_HASH;
    const responseLimit = 1024 * 1024;
    const msg = new s.GetStorageRange(reqid, requestRoot, accountHashes, startHash, limitHash, responseLimit);
    let proof: Buffer[] = [];
    let keys: Buffer[][] = [];
    let values: Buffer[][] = [];
    const callback = (data: Buffer) => {
      const msgInstance = s.SnapMessageFactory.fromSerializedMessage(data) as s.StorageRange;
      expect(msgInstance.reqID === reqid, 'reqID should be equal').to.be.true;
      const storageData = sortAccounts.map((account) => Array.from(account.storageData.keys()).map((key) => [key, account.storageData.get(key)!.val]));
      for (let i = 0; i < msgInstance.slots.length; i++) {
        for (let j = 0; j < msgInstance.slots[i].length; j++) {
          expect(msgInstance.slots[i][j][0].equals(storageData[i][j][0]), 'storageHash should be equal').to.be.true;
          expect(msgInstance.slots[i][j][1].equals(storageData[i][j][1]), 'storageData should be equal').to.be.true;
        }
      }
      proof = msgInstance.proof;
      keys = msgInstance.slots.map((slot) => slot.map((slot) => slot[0]));
      values = msgInstance.slots.map((slot) => slot.map((slot) => slot[1]));
    };
    (handler.peer as any as MockPeer).callback = callback;
    const data = rlp.encode([intToBuffer(s.GetStorageRange.code), msg.raw()]);
    await handler.handle(data);
    await Trie.verifyRangeProof(sortAccounts[0].account.stateRoot, EMPTY_HASH, MAX_HASH, keys[0], values[0], proof);
    reqid++;
  });

  it('should handleGetByteCode correctly', async () => {
    const codeHashes = accounts.map((account) => keccak256(account.code));
    const responseLimit = 1024;
    const msg = new s.GetByteCode(reqid, codeHashes, responseLimit);
    const code = accounts.map((account) => account.code);
    const callback = (data: Buffer) => {
      const msgInstance = s.SnapMessageFactory.fromSerializedMessage(data) as s.ByteCode;
      expect(msgInstance.reqID === reqid, 'reqID should be equal').to.be.true;
      for (let i = 0; i < msgInstance.codes.length; i++) {
        expect(msgInstance.codes[i].equals(code[i]), 'codes should be equal').to.be.true;
      }
    };
    (handler.peer as any as MockPeer).callback = callback;
    const data = rlp.encode([intToBuffer(s.GetByteCode.code), msg.raw()]);
    await handler.handle(data);
    reqid++;
  });

  it('should handleGetTrieNode correctly', async () => {
    const requestRoot = root;
    const responseLimit = 1024;
    let paths = accounts.map((account) => [account.accountHash]);
    const msg1 = new s.GetTrieNode(reqid, requestRoot, paths, responseLimit);
    const callback1 = (data: Buffer) => {
      const msgInstance = s.SnapMessageFactory.fromSerializedMessage(data) as s.TrieNode;
      expect(msgInstance.reqID === reqid, 'reqID should be equal').to.be.true;
      const nodes = accounts.map((account) => account.account.serialize());
      for (let i = 0; i < msgInstance.nodes.length; i++) {
        expect(msgInstance.nodes[i].equals(nodes[i]), 'nodes should be equal').to.be.true;
      }
    };
    (handler.peer as any as MockPeer).callback = callback1;
    const data1 = rlp.encode([intToBuffer(s.GetTrieNode.code), msg1.raw()]);
    await handler.handle(data1);

    paths = accounts.map((account) => [account.accountHash].concat(Array.from(account.storageData.keys())));
    const msg2 = new s.GetTrieNode(reqid, requestRoot, paths, responseLimit);
    const callback2 = (data: Buffer) => {
      const msgInstance = s.SnapMessageFactory.fromSerializedMessage(data) as s.TrieNode;
      expect(msgInstance.reqID === reqid, 'reqID should be equal').to.be.true;
      const nodes: Buffer[] = [];
      accounts.forEach((account) => Array.from(account.storageData.keys()).forEach((key) => nodes.push(account.storageData.get(key)!.val)));
      for (let i = 0; i < msgInstance.nodes.length; i++) {
        expect(msgInstance.nodes[i].equals(nodes[i]), 'nodes should be equal').to.be.true;
      }
    };
    const data2 = rlp.encode([intToBuffer(s.GetTrieNode.code), msg2.raw()]);
    (handler.peer as any as MockPeer).callback = callback2;
    await handler.handle(data2);
  });
});
