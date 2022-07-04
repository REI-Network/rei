import { expect } from 'chai';
import { BN, keccak256 } from 'ethereumjs-util';
import crypto from 'crypto';
import { Common } from '@rei-network/common';
import { Database } from '@rei-network/database';
import { AccountInfo, genRandomAccounts } from './util';
import { SnapTree } from '../../src/snap/snapTree';
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
  public resHander: SnapProtocolHandler | undefined = undefined;

  public send(name: string, data: Buffer) {
    if (this.resHander) {
      return this.resHander.handle(data);
    }
  }

  setHander(handler: SnapProtocolHandler) {
    this.resHander = handler;
  }

  isSupport(protocol: string) {
    return true;
  }
}

const level = require('level-mem');
const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);
const db = new Database(level(), common);
const count = 10;
let root: Buffer;
let accounts: AccountInfo[];
const protocolName = 'snap protocol';
let handler1: SnapProtocolHandler;
let handler2: SnapProtocolHandler;

describe('snap protocol handler', function () {
  before(async () => {
    const genRandResult = await genRandomAccounts(db, count, count);
    root = genRandResult.root;
    accounts = genRandResult.accounts;
    const node = new MockNode(db);
    await node.snaptree.init(root, true, true);
    const protocol = new MockProctocol(protocolName, node);
    const peer = new MockPeer();
    handler1 = new SnapProtocolHandler(protocol as any, peer as any);
    handler2 = new SnapProtocolHandler(protocol as any, peer as any);
    (handler1.peer as any as MockPeer).setHander(handler2);
    (handler2.peer as any as MockPeer).setHander(handler1);
    await handler1.handshake();
    await handler2.handshake();
  });

  it('should getAccountRange correctly', async () => {
    const requestRoot = root;
    const sortAccounts = accounts.sort((a, b) => a.accountHash.compare(b.accountHash));

    const startHash1 = sortAccounts[0].accountHash;
    const limitHash1 = sortAccounts[sortAccounts.length - 2].accountHash;
    const sortAccounts1 = sortAccounts.slice(0, sortAccounts.length - 1);
    const accountData1 = sortAccounts1.map((account) => [account.accountHash, account.account.serialize()]);
    const response1 = await handler1.getAccountRange(requestRoot, { origin: startHash1, limit: limitHash1 });
    expect(response1 !== null, 'response1 should not be null').to.be.true;
    if (response1) {
      for (let i = 0; i < response1.accounts.length; i++) {
        expect(response1.hashes[i].equals(accountData1[i][0]), 'accountHashes should be equal').to.be.true;
        expect(response1.accounts[i].slimSerialize().equals(accountData1[i][1]), 'accountBody should be equal').to.be.true;
      }
      expect(response1.cont === true, 'cont should be true').to.be.true;
    }

    const startHash2 = sortAccounts[0].accountHash;
    const limitHash2 = sortAccounts[sortAccounts.length - 1].accountHash;
    const sortAccounts2 = sortAccounts;
    const accountData2 = sortAccounts2.map((account) => [account.accountHash, account.account.serialize()]);
    const response2 = await handler1.getAccountRange(requestRoot, { origin: startHash2, limit: limitHash2 });
    expect(response2 !== null, 'response2 should not be null').to.be.true;
    if (response2) {
      for (let i = 0; i < response2!.accounts.length; i++) {
        expect(response2!.hashes[i].equals(accountData2[i][0]), 'accountHashes should be equal').to.be.true;
        expect(response2!.accounts[i].slimSerialize().equals(accountData2[i][1]), 'accountBody should be equal').to.be.true;
      }
      expect(response2!.cont === false, 'cont should be false').to.be.true;
    }
  });

  it('should getStorageRange correctly', async () => {
    const requestRoot = root;
    const accountHashes = accounts.map((account) => account.accountHash);
    const startHash1 = EMPTY_HASH;
    const limitHash1 = MAX_HASH;
    const roots = accounts.map((account) => account.account.stateRoot);
    const storageHash = accounts.map((account) => Array.from(account.storageData.keys()).map((key) => key));
    const stotageData = accounts.map((account) => Array.from(account.storageData.values()).map((value) => value.val));
    const response1 = await handler1.getStorageRange(requestRoot, { origin: startHash1, limit: limitHash1, roots: roots, accounts: accountHashes });
    expect(response1 !== null, 'response should not be null').to.be.true;
    if (response1) {
      for (let i = 0; i < response1.hashes.length; i++) {
        for (let j = 0; j < response1.slots[i].length; j++) {
          expect(response1.hashes[i][j].equals(storageHash[i][j]), 'accountHashes should be equal').to.be.true;
          expect(response1.slots[i][j].equals(stotageData[i][j]), 'storageData should be equal').to.be.true;
        }
      }
      expect(response1.cont === false, 'cont should be false').to.be.true;
    }

    const keys = Array.from(accounts[0].storageData.keys());
    const startHash2 = keys[0];
    const limitHash2 = MAX_HASH;
    const roots2 = [roots[0]];
    const accounts2 = [accountHashes[0]];
    const response2 = await handler1.getStorageRange(requestRoot, { origin: startHash2, limit: limitHash2, roots: roots2, accounts: accounts2 });
    expect(response2 !== null, 'response should not be null').to.be.true;
    if (response2) {
      for (let i = 0; i < response2.hashes.length; i++) {
        for (let j = 0; j < response2.slots[i].length; j++) {
          expect(response2.hashes[i][j].equals(storageHash[i][j]), 'accountHashes should be equal').to.be.true;
          expect(response2.slots[i][j].equals(stotageData[i][j]), 'storageData should be equal').to.be.true;
        }
      }
      expect(response2.cont === false, 'cont should be false').to.be.true;
    }
  });

  it('should getCodeByte correctly ', async () => {
    const codeHashes1 = accounts.map((account) => keccak256(account.code));
    const code = accounts.map((account) => account.code);
    const response = await handler1.getByteCode(codeHashes1);
    for (let i = 0; i < code.length; i++) {
      expect(response![i].equals(code[i]), 'ByteCode should be equal').to.be.true;
    }

    const codeHashes2 = codeHashes1;
    await handler1.node.db.rawdb.put(codeHashes1[0], crypto.randomBytes(100), { keyEncoding: 'binary', valueEncoding: 'binary' });
    const response2 = await handler1.getByteCode(codeHashes2);
    expect(response2 === null, 'response should be null').to.be.true;
  });

  it('should getTrieNode correctly', async () => {
    const trie = new BaseTrie(db.rawdb, root);
    const Interator = new TrieNodeIterator(trie);
    let i = 0;
    let keys: Buffer[] = [];
    let values: Buffer[] = [];
    for await (const node of Interator) {
      if (i >= 5) {
        break;
      }
      keys.push(node.hash());
      values.push(node.serialize());
      i++;
    }
    const response1 = await handler1.getTrieNode(keys);
    expect(response1 !== null, 'response should not be null').to.be.true;
    if (response1) {
      for (let i = 0; i < response1.length; i++) {
        expect(response1[i].equals(values[i]), 'nodes should be equal').to.be.true;
      }
    }

    await handler1.node.db.rawdb.put(keys[0], crypto.randomBytes(100), { keyEncoding: 'binary', valueEncoding: 'binary' });
    const response2 = await handler1.getTrieNode(keys);
    expect(response2 === null, 'response should be null').to.be.true;
  });

  it('should abort correctly', async () => {
    expect((handler1.protocol.pool as any as Mockpool).has(handler1), 'handler should in the pool').to.be.true;
    handler1.abort();
    expect((handler1.protocol.pool as any as Mockpool).has(handler1), 'handler should removed from the pool').to.be.false;
  });
});
