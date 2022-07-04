import { expect } from 'chai';
import crypto from 'crypto';
import { BN, keccak256 } from 'ethereumjs-util';
import { BaseTrie } from 'merkle-patricia-tree';
import { Common } from '@rei-network/common';
import { Database } from '@rei-network/database';
import { AccountInfo, genRandomAccounts } from './util';
import { SnapTree } from '../../src/snap/snapTree';
import { SnapProtocolHandler } from '../../src/protocols/snap';
import { EMPTY_HASH, MAX_HASH } from '../../src/utils';
import { TrieNodeIterator } from '../../src/snap/trieIterator';

class MockNode {
  snaptree: SnapTree;
  db: Database;
  latestBlock: { header: { number: BN } } = { header: { number: new BN(1) } };

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
  name: string;
  node: any;
  pool: Mockpool = new Mockpool();

  constructor(name: string, node: any) {
    this.name = name;
    this.node = node;
  }
}

class MockPeer {
  resHandler: SnapProtocolHandler | undefined = undefined;

  send(name: string, data: Buffer) {
    if (this.resHandler) {
      return this.resHandler.handle(data);
    }
  }

  setHander(handler: SnapProtocolHandler) {
    this.resHandler = handler;
  }

  isSupport(protocol: string) {
    return true;
  }
}

const level = require('level-mem');
const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);
const db = new Database(level(), common);
const node = new MockNode(db);
const protocol1 = new MockProctocol('snap protocol', node);
const protocol2 = new MockProctocol('snap protocol', node);
let root: Buffer;
let accounts: AccountInfo[];
let handler1: SnapProtocolHandler;
let handler2: SnapProtocolHandler;
const trieNodeKeys: Buffer[] = [];
const trieNodeValues: Buffer[] = [];

describe('snap protocol handler', function () {
  before(async () => {
    const genRandResult = await genRandomAccounts(db, 10, 10);
    root = genRandResult.root;
    accounts = genRandResult.accounts.sort((a, b) => a.accountHash.compare(b.accountHash));
    await node.snaptree.init(root, true, true);
    const peer1 = new MockPeer();
    const peer2 = new MockPeer();
    handler1 = new SnapProtocolHandler(protocol1 as any, peer1 as any, 20000);
    handler2 = new SnapProtocolHandler(protocol2 as any, peer2 as any, 500);
    (peer1 as MockPeer).setHander(handler2);
    (peer2 as MockPeer).setHander(handler1);
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
    expect(protocol1.pool.has(handler1), 'handler should in the pool').to.be.true;

    expect(protocol2.pool.has(handler2), 'handler should not in the pool').to.be.false;
    await handler2.handshake();
    expect(protocol2.pool.has(handler2), 'handler should in the pool').to.be.true;
  });

  it('should getAccountRange successfully and continue is false', async () => {
    const startHash = accounts[0].accountHash;
    const limitHash = accounts[accounts.length - 1].accountHash;
    const accountData = accounts.map((account) => [account.accountHash, account.account.slimSerialize()]);
    const response = await handler2.getAccountRange(root, { origin: startHash, limit: limitHash });
    expect(response !== null, 'response should not be null').to.be.true;
    expect(response!.accounts.length === response!.hashes.length, 'accounts length should be equal').to.be.true;
    expect(response!.cont === false, 'continue should be false').to.be.true;
    expect(response!.accounts.length === accountData.length, 'accounts length should be equal').to.be.true;
    for (let i = 0; i < response!.accounts.length; i++) {
      expect(response!.hashes[i].equals(accountData[i][0]), 'accountHashes should be equal').to.be.true;
      expect(response!.accounts[i].slimSerialize().equals(accountData[i][1]), 'accountBody should be equal').to.be.true;
    }
  });

  it('should getAccountRange successfully and continue is true', async () => {
    const startHash = accounts[0].accountHash;
    const limitHash = accounts[accounts.length - 2].accountHash;
    const accountData = accounts.slice(0, accounts.length - 1).map((account) => [account.accountHash, account.account.slimSerialize()]);
    const response = await handler2.getAccountRange(root, { origin: startHash, limit: limitHash });
    expect(response !== null, 'response should not be null').to.be.true;
    expect(response!.accounts.length === response!.hashes.length, 'accounts length should be equal').to.be.true;
    expect(response!.cont === true, 'continue should be true').to.be.true;
    expect(response!.accounts.length === accountData.length, 'accounts length should be equal').to.be.true;
    for (let i = 0; i < response!.accounts.length; i++) {
      expect(response!.hashes[i].equals(accountData[i][0]), 'accountHashes should be equal').to.be.true;
      expect(response!.accounts[i].slimSerialize().equals(accountData[i][1]), 'accountBody should be equal').to.be.true;
    }
  });

  it('should getAccountRange successfully and continue is true when the responseLimit could not cover request accounts', async () => {
    const startHash = accounts[0].accountHash;
    const limitHash = accounts[accounts.length - 1].accountHash;
    const accountData = accounts.map((account) => [account.accountHash, account.account.slimSerialize()]);
    const response = await handler1.getAccountRange(root, { origin: startHash, limit: limitHash });
    expect(response !== null, 'response should not be null').to.be.true;
    expect(response!.accounts.length === response!.hashes.length, 'accounts length should be equal').to.be.true;
    expect(response!.cont === true, 'continue should be true').to.be.true;
    expect(response!.accounts.length < accountData.length, 'accounts length should be less than accounts').to.be.true;
    for (let i = 0; i < response!.accounts.length; i++) {
      expect(response!.hashes[i].equals(accountData[i][0]), 'accountHashes should be equal').to.be.true;
      expect(response!.accounts[i].slimSerialize().equals(accountData[i][1]), 'accountBody should be equal').to.be.true;
    }
  });

  it('should getAccountRange successfully continue is true', async () => {
    const startHash = EMPTY_HASH;
    const limitHash = MAX_HASH;
    const accountHashes = accounts.map((account) => account.accountHash);
    const roots = accounts.map((account) => account.account.stateRoot);
    const storageHash = accounts.map((account) => Array.from(account.storageData.keys()));
    const stotageData = accounts.map((account) => Array.from(account.storageData.values()).map((value) => value.val));
    const response = await handler2.getStorageRange(root, { origin: startHash, limit: limitHash, roots: roots, accounts: accountHashes });
    expect(response !== null, 'response should not be null').to.be.true;
    expect(response!.slots.length === stotageData.length, 'slots length should be equal').to.be.true;
    expect(response!.slots.length === response!.hashes.length, 'slots length should equal hashes length').to.be.true;
    expect(response!.cont === false, 'continue should be false').to.be.true;
    for (let i = 0; i < response!.hashes.length; i++) {
      for (let j = 0; j < response!.slots[i].length; j++) {
        expect(response!.hashes[i][j].equals(storageHash[i][j]), 'accountHashes should be equal').to.be.true;
        expect(response!.slots[i][j].equals(stotageData[i][j]), 'storageData should be equal').to.be.true;
      }
    }
  });

  it('should getAccountRange successfully when origin is setted', async () => {
    const startHash = Array.from(accounts[0].storageData.keys())[0];
    const limitHash = MAX_HASH;
    const accountHashes = accounts.map((account) => account.accountHash);
    const roots = accounts.map((account) => account.account.stateRoot);
    const storageHash = accounts.map((account) => Array.from(account.storageData.keys()));
    const stotageData = accounts.map((account) => Array.from(account.storageData.values()).map((value) => value.val));
    const response = await handler2.getStorageRange(root, { origin: startHash, limit: limitHash, roots: roots, accounts: accountHashes });
    expect(response !== null, 'response should not be null').to.be.true;
    expect(response!.slots.length === 1, 'slots length should be equal').to.be.true;
    expect(response!.slots.length === response!.hashes.length, 'slots length should equal hashes length').to.be.true;
    expect(response!.cont === false, 'continue should be false').to.be.true;
    for (let i = 0; i < response!.hashes.length; i++) {
      for (let j = 0; j < response!.slots[i].length; j++) {
        expect(response!.hashes[i][j].equals(storageHash[i][j]), 'accountHashes should be equal').to.be.true;
        expect(response!.slots[i][j].equals(stotageData[i][j]), 'storageData should be equal').to.be.true;
      }
    }
  });

  it('should getAccountRange successfully when responseLimit could not cover request storage', async () => {
    const startHash = EMPTY_HASH;
    const limitHash = MAX_HASH;
    const accountHashes = accounts.map((account) => account.accountHash);
    const roots = accounts.map((account) => account.account.stateRoot);
    const storageHash = accounts.map((account) => Array.from(account.storageData.keys()));
    const stotageData = accounts.map((account) => Array.from(account.storageData.values()).map((value) => value.val));
    const response = await handler1.getStorageRange(root, { origin: startHash, limit: limitHash, roots: roots, accounts: accountHashes });
    expect(response !== null, 'response should not be null').to.be.true;
    expect(response!.slots.length < stotageData.length, 'slots length should be less than request').to.be.true;
    expect(response!.slots.length === response!.hashes.length, 'slots length should equal hashes length').to.be.true;
    expect(response!.cont === true, 'continue should be true').to.be.true;
    for (let i = 0; i < response!.hashes.length; i++) {
      for (let j = 0; j < response!.slots[i].length; j++) {
        expect(response!.hashes[i][j].equals(storageHash[i][j]), 'accountHashes should be equal').to.be.true;
        expect(response!.slots[i][j].equals(stotageData[i][j]), 'storageData should be equal').to.be.true;
      }
    }
  });

  it('should getCodeBytes successfully', async () => {
    const codeHashes = accounts.map((account) => keccak256(account.code));
    const code = accounts.map((account) => account.code);
    const response = await handler2.getByteCode(codeHashes);
    expect(response !== null, 'response should not be null').to.be.true;
    expect(response!.length === code.length, 'code length should be equal').to.be.true;
    for (let i = 0; i < code.length; i++) {
      expect(response![i]!.equals(code[i]), 'ByteCode should be equal').to.be.true;
    }
  });

  it('should getCodeBytes successfully when responseLimit could not cover request', async () => {
    const codeHashes = accounts.map((account) => keccak256(account.code));
    const code = accounts.map((account) => account.code);
    const response = await handler1.getByteCode(codeHashes);
    expect(response !== null, 'response should not be null').to.be.true;
    expect(response!.length === code.length, 'code length should be less than request').to.be.true;
    for (let i = 0; i < code.length; i++) {
      const comment = response![i];
      expect(comment === undefined || comment.equals(code[i]), 'ByteCode should be equal or undifined').to.be.true;
    }
  });

  it('should getCodeByte unsuccessfully', async () => {
    const codeHashes = accounts.map((account) => keccak256(account.code));
    await db.rawdb.put(codeHashes[0], crypto.randomBytes(100), { keyEncoding: 'binary', valueEncoding: 'binary' });
    const response = await handler1.getByteCode(codeHashes);
    expect(response === null, 'response should be null').to.be.true;
  });

  it('should getTrieNode successfully', async () => {
    const response = await handler2.getTrieNode(trieNodeKeys);
    expect(response !== null, 'response should not be null').to.be.true;
    expect(response!.length === trieNodeValues.length, 'trieNode length should be equal').to.be.true;
    for (let i = 0; i < trieNodeValues.length; i++) {
      expect(response![i]!.equals(trieNodeValues[i]), 'trieNode should be equal').to.be.true;
    }
  });

  it('should getTrieNode successfully when responseLimit could not cover request', async () => {
    const response = await handler2.getTrieNode(trieNodeKeys);
    expect(response !== null, 'response should not be null').to.be.true;
    expect(response!.length === trieNodeValues.length, 'trieNode length should be equal').to.be.true;
    for (let i = 0; i < trieNodeValues.length; i++) {
      const comment = response![i];
      expect(comment === undefined || comment.equals(trieNodeValues[i]), 'trieNode should be equal or undifined').to.be.true;
    }
  });

  it('should getTrieNode unsuccessfully', async () => {
    await db.rawdb.put(trieNodeKeys[0], crypto.randomBytes(100), { keyEncoding: 'binary', valueEncoding: 'binary' });
    const response = await handler1.getTrieNode(trieNodeKeys);
    expect(response === null, 'response should be null').to.be.true;
  });

  it('should abort correctly', async () => {
    expect(protocol1.pool.has(handler1), 'handler should in the pool').to.be.true;
    handler1.abort();
    expect(protocol1.pool.has(handler1), 'handler should not in the pool').to.be.false;

    expect(protocol2.pool.has(handler2), 'handler should in the pool').to.be.true;
    handler2.abort();
    expect(protocol2.pool.has(handler2), 'handler should not in the pool').to.be.false;
  });
});
