import { expect } from 'chai';
import crypto from 'crypto';
import { keccak256 } from 'ethereumjs-util';
import { BaseTrie } from 'merkle-patricia-tree';
import { Common } from '@rei-network/common';
import { Database } from '@rei-network/database';
import { AccountInfo, genRandomAccounts, addEmptyAccounts } from './util';
import { SnapTree } from '../../src/snap/snapTree';
import { SnapProtocolHandler } from '../../src/protocols/snap';
import { EMPTY_HASH, MAX_HASH } from '../../src/utils';
import { TrieNodeIterator } from '../../src/snap/trieIterator';

class MockNode {
  snapTree: SnapTree;
  db: Database;

  constructor(db: Database) {
    this.db = db;
    this.snapTree = new SnapTree(db);
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

  putBackIdlePeer(type: string, handler: SnapProtocolHandler) {
    // this.add(handler);
  }
}

class MockProctocol {
  node: any;
  pool: Mockpool = new Mockpool();

  constructor(node: any) {
    this.node = node;
  }
}

class MockPeer {
  remote!: SnapProtocolHandler;

  stream() {
    const self = this;
    return {
      send(data: Buffer) {
        self.remote.handle(data);
      }
    };
  }

  setRemote(handler: SnapProtocolHandler) {
    this.remote = handler;
  }
}

const level = require('level-mem');
const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);
const db = new Database(level(), common);
const node = new MockNode(db);
const protocol1 = new MockProctocol(node);
const protocol2 = new MockProctocol(node);
let root: Buffer;
let accounts: AccountInfo[];
let sortAccounts: AccountInfo[];
let handler1: SnapProtocolHandler;
let handler2: SnapProtocolHandler;
const trieNodeKeys: Buffer[] = [];
const trieNodeValues: Buffer[] = [];
const emptyAccountCount = 2;

describe('SnapProtocol', function () {
  before(async () => {
    const result = await genRandomAccounts(db, 10, 10);
    const genRandResult = await addEmptyAccounts(db, emptyAccountCount, result);
    root = genRandResult.root;
    accounts = genRandResult.accounts;
    sortAccounts = [...genRandResult.accounts].sort((a, b) => a.accountHash.compare(b.accountHash));
    await node.snapTree.init(root, false, true);
    const peer1 = new MockPeer();
    const peer2 = new MockPeer();
    handler1 = new SnapProtocolHandler(protocol1 as any, peer1 as any, peer1.stream() as any, 20000);
    handler2 = new SnapProtocolHandler(protocol2 as any, peer2 as any, peer2.stream() as any, 20000);
    peer1.setRemote(handler2);
    peer2.setRemote(handler1);
    const trie = new BaseTrie(db.rawdb, root);
    const iterator = new TrieNodeIterator(trie);
    let i = 0;
    for await (const node of iterator) {
      if (i >= 10) {
        break;
      }
      trieNodeKeys.push(node.hash());
      trieNodeValues.push(node.serialize());
      i++;
    }
  });

  it('should handshake successfully', async () => {
    expect(protocol1.pool.has(handler1), 'handler should not in the pool').to.be.false;
    await handler1.handshake();
    expect(protocol1.pool.has(handler1), 'handler should in the pool').be.true;

    expect(protocol2.pool.has(handler2), 'handler should not in the pool').to.be.false;
    await handler2.handshake();
    expect(protocol2.pool.has(handler2), 'handler should in the pool').be.true;
  });

  it('should getAccountRange successfully and continue is false', async () => {
    const startHash = sortAccounts[0].accountHash;
    const limitHash = sortAccounts[sortAccounts.length - 1].accountHash;
    const accountData = sortAccounts.map((account) => [account.accountHash, account.account.slimSerialize()]);
    const response = await handler2.getAccountRange(root, { origin: startHash, limit: limitHash });
    expect(response !== null, 'response should not be null').be.true;
    expect(response!.accounts.length, 'accounts length should be equal').be.equal(response!.hashes.length);
    expect(response!.cont, 'continue should be false').be.equal(false);
    expect(response!.accounts.length, 'accounts length should be equal').be.equal(accountData.length);
    for (let i = 0; i < response!.accounts.length; i++) {
      expect(response!.hashes[i].equals(accountData[i][0]), 'accountHashes should be equal').be.true;
      expect(response!.accounts[i].slimSerialize().equals(accountData[i][1]), 'accountBody should be equal').be.true;
    }
  });

  it('should getAccountRange successfully and continue is true', async () => {
    const startHash = sortAccounts[0].accountHash;
    const limitHash = sortAccounts[sortAccounts.length - 2].accountHash;
    const accountData = sortAccounts.slice(0, sortAccounts.length - 1).map((account) => [account.accountHash, account.account.slimSerialize()]);
    const response = await handler2.getAccountRange(root, { origin: startHash, limit: limitHash });
    expect(response !== null, 'response should not be null').be.true;
    expect(response!.accounts.length, 'accounts length should be equal').be.equal(response!.hashes.length);
    expect(response!.cont, 'continue should be true').be.equal(true);
    expect(response!.accounts.length, 'accounts length should be equal').be.equal(accountData.length);
    for (let i = 0; i < response!.accounts.length; i++) {
      expect(response!.hashes[i].equals(accountData[i][0]), 'accountHashes should be equal').be.true;
      expect(response!.accounts[i].slimSerialize().equals(accountData[i][1]), 'accountBody should be equal').be.true;
    }
  });

  it('should getAccountRange successfully and continue is true when the responseLimit could not cover request accounts', async () => {
    handler2.resetSoftResponseLimit(500);
    const startHash = sortAccounts[0].accountHash;
    const limitHash = sortAccounts[sortAccounts.length - 1].accountHash;
    const accountData = sortAccounts.map((account) => [account.accountHash, account.account.slimSerialize()]);
    const response = await handler1.getAccountRange(root, { origin: startHash, limit: limitHash });
    expect(response !== null, 'response should not be null').be.true;
    expect(response!.accounts.length, 'accounts length should be equal').be.equal(response!.hashes.length);
    expect(response!.cont, 'continue should be true').be.equal(true);
    expect(response!.accounts.length < accountData.length, 'accounts length should be less than accounts').be.true;
    for (let i = 0; i < response!.accounts.length; i++) {
      expect(response!.hashes[i].equals(accountData[i][0]), 'accountHashes should be equal').be.true;
      expect(response!.accounts[i].slimSerialize().equals(accountData[i][1]), 'accountBody should be equal').be.true;
    }
    handler2.resetSoftResponseLimit(20000);
  });

  it('should getStorageRange successfully continue is true', async () => {
    const startHash = EMPTY_HASH;
    const limitHash = MAX_HASH;
    const accountHashes = accounts.map((account) => account.accountHash);
    const roots = accounts.map((account) => account.account.stateRoot);
    const storageHash = accounts.map((account) => Array.from(account.storageData.keys()));
    const stotageData = accounts.map((account) => Array.from(account.storageData.values()).map((value) => value.val));
    const response = await handler2.getStorageRanges(root, { origin: startHash, limit: limitHash, roots: roots, accounts: accountHashes });
    expect(response !== null, 'response should not be null').be.true;
    expect(response!.slots.length, 'slots length should be equal').be.equal(stotageData.length - emptyAccountCount);
    expect(response!.slots.length, 'slots length should equal hashes length').be.equal(response!.hashes.length);
    expect(response!.cont, 'continue should be false').be.equal(false);
    for (let i = 0; i < response!.hashes.length; i++) {
      for (let j = 0; j < response!.slots[i].length; j++) {
        expect(response!.hashes[i][j].equals(storageHash[i][j]), 'accountHashes should be equal').be.true;
        expect(response!.slots[i][j].equals(stotageData[i][j]), 'storageData should be equal').be.true;
      }
    }
  });

  it('should getStorageRange successfully when origin is setted', async () => {
    const startHash = Array.from(accounts[0].storageData.keys())[0];
    const limitHash = MAX_HASH;
    const accountHashes = accounts.map((account) => account.accountHash);
    const roots = accounts.map((account) => account.account.stateRoot);
    const storageHash = accounts.map((account) => Array.from(account.storageData.keys()));
    const stotageData = accounts.map((account) => Array.from(account.storageData.values()).map((value) => value.val));
    const response = await handler2.getStorageRanges(root, { origin: startHash, limit: limitHash, roots: roots, accounts: accountHashes });
    expect(response !== null, 'response should not be null').be.true;
    expect(response!.slots.length, 'slots length should be equal').be.equal(1);
    expect(response!.slots.length, 'slots length should equal hashes length').be.equal(response!.hashes.length);
    expect(response!.cont, 'continue should be false').be.equal(false);
    for (let i = 0; i < response!.hashes.length; i++) {
      for (let j = 0; j < response!.slots[i].length; j++) {
        expect(response!.hashes[i][j].equals(storageHash[i][j]), 'accountHashes should be equal').be.true;
        expect(response!.slots[i][j].equals(stotageData[i][j]), 'storageData should be equal').be.true;
      }
    }
  });

  it('should getStorageRange successfully when responseLimit could not cover request storage', async () => {
    handler2.resetSoftResponseLimit(500);
    const startHash = EMPTY_HASH;
    const limitHash = MAX_HASH;
    const accountHashes = accounts.map((account) => account.accountHash);
    const roots = accounts.map((account) => account.account.stateRoot);
    const storageHash = accounts.map((account) => Array.from(account.storageData.keys()));
    const stotageData = accounts.map((account) => Array.from(account.storageData.values()).map((value) => value.val));
    const response = await handler1.getStorageRanges(root, { origin: startHash, limit: limitHash, roots: roots, accounts: accountHashes });
    expect(response !== null, 'response should not be null').be.true;
    expect(response!.slots.length < stotageData.length, 'slots length should be less than request').be.true;
    expect(response!.slots.length, 'slots length should equal hashes length').be.equal(response!.hashes.length);
    expect(response!.cont, 'continue should be true').be.equal(true);
    for (let i = 0; i < response!.hashes.length; i++) {
      for (let j = 0; j < response!.slots[i].length; j++) {
        expect(response!.hashes[i][j].equals(storageHash[i][j]), 'accountHashes should be equal').be.true;
        expect(response!.slots[i][j].equals(stotageData[i][j]), 'storageData should be equal').be.true;
      }
    }
    handler2.resetSoftResponseLimit(20000);
  });

  it('should getCodeBytes successfully', async () => {
    const codeHashes = accounts.map((account) => keccak256(account.code));
    const code = accounts.map((account) => account.code);
    const response = await handler2.getByteCodes(codeHashes);
    expect(response !== null, 'response should not be null').be.true;
    expect(response!.length, 'code length should be equal').be.equal(code.length);
    for (let i = 0; i < code.length; i++) {
      expect(response![i]!.equals(code[i]), 'ByteCode should be equal').be.true;
    }
  });

  it('should getCodeBytes successfully when responseLimit could not cover request', async () => {
    const codeHashes = accounts.map((account) => keccak256(account.code));
    const code = accounts.map((account) => account.code);
    const response = await handler1.getByteCodes(codeHashes);
    expect(response !== null, 'response should not be null').be.true;
    expect(response!.length, 'code length should equal').be.equal(code.length);
    for (let i = 0; i < code.length; i++) {
      const element = response![i];
      expect(element === undefined || element.equals(code[i]), 'ByteCode should be equal or undifined').be.true;
    }
  });

  it('should getCodeBytes successfully when some codeHash missing', async () => {
    const codeHashes = accounts.map((account) => keccak256(account.code));
    const code = accounts.map((account) => account.code);
    const deleteCount = 5;
    await db.rawdb.del(codeHashes[deleteCount], { keyEncoding: 'binary', valueEncoding: 'binary' });
    const response = await handler2.getByteCodes(codeHashes);
    expect(response !== null, 'response should not be null').be.true;
    expect(response!.length, 'code length should be equal').be.equal(code.length);
    for (let i = 0; i < code.length; i++) {
      if (i === deleteCount) {
        expect(response![i], 'ByteCode should be undefined').be.equal(undefined);
        continue;
      }
      expect(response![i]!.equals(code[i]), 'ByteCode should be equal').be.true;
    }
  });

  it('should getCodeByte unsuccessfully', async () => {
    const codeHashes = accounts.map((account) => keccak256(account.code));
    await db.rawdb.put(codeHashes[0], crypto.randomBytes(100), { keyEncoding: 'binary', valueEncoding: 'binary' });
    const response = await handler1.getByteCodes(codeHashes);
    expect(response, 'response should be null').be.equal(null);
  });

  it('should getTrieNode successfully', async () => {
    const response = await handler2.getTrieNodes(trieNodeKeys);
    expect(response !== null, 'response should not be null').be.true;
    expect(response!.length, 'trieNode length should be equal').be.equal(trieNodeValues.length);
    for (let i = 0; i < trieNodeValues.length; i++) {
      expect(response![i]!.equals(trieNodeValues[i]), 'trieNode should be equal').be.true;
    }
  });

  it('should getTrieNode successfully when responseLimit could not cover request', async () => {
    const response = await handler2.getTrieNodes(trieNodeKeys);
    expect(response !== null, 'response should not be null').be.true;
    expect(response!.length, 'trieNode length should be equal').be.equal(trieNodeValues.length);
    for (let i = 0; i < trieNodeValues.length; i++) {
      const element = response![i];
      expect(element === undefined || element.equals(trieNodeValues[i]), 'trieNode should be equal or undifined').be.true;
    }
  });

  it('should getTrieNode successfully when some node missing', async () => {
    const deleteCount = 5;
    await db.rawdb.del(trieNodeKeys[deleteCount], { keyEncoding: 'binary', valueEncoding: 'binary' });
    const response = await handler2.getTrieNodes(trieNodeKeys);
    expect(response !== null, 'response should not be null').be.true;
    expect(response!.length, 'trieNode length should be equal').be.equal(trieNodeValues.length);
    for (let i = 0; i < trieNodeValues.length; i++) {
      if (i === deleteCount) {
        expect(response![i], 'trieNode should be undefined').be.equal(undefined);
        continue;
      }
      expect(response![i]!.equals(trieNodeValues[i]), 'trieNode should be equal').be.true;
    }
  });

  it('should getTrieNode unsuccessfully', async () => {
    await db.rawdb.put(trieNodeKeys[0], crypto.randomBytes(100), { keyEncoding: 'binary', valueEncoding: 'binary' });
    const response = await handler1.getTrieNodes(trieNodeKeys);
    expect(response, 'response should be null').be.equal(null);
  });

  it('should abort correctly', async () => {
    expect(protocol1.pool.has(handler1), 'handler should in the pool').be.true;
    handler1.abort();
    expect(protocol1.pool.has(handler1), 'handler should not in the pool').to.be.false;

    expect(protocol2.pool.has(handler2), 'handler should in the pool').be.true;
    handler2.abort();
    expect(protocol2.pool.has(handler2), 'handler should not in the pool').to.be.false;
  });
});
