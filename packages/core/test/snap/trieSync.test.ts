import { expect } from 'chai';
import { LevelUp } from 'levelup';
import { SecureTrie, BaseTrie } from 'merkle-patricia-tree';
import { BranchNode, TrieNode, ExtensionNode } from 'merkle-patricia-tree/dist/trieNode';
import { Common } from '@rei-network/common';
import { Database, DBOpData } from '@rei-network/database';
import { getRandomIntInclusive } from '@rei-network/utils';
import { BinaryRawDBatch } from '../../src/snap/batch';
import { TrieSync, TrieSyncBackend } from '../../src/snap/trieSync';
import { TrieIterator } from '../../src/snap/trieIterator';
import { AccountInfo, genRandomAccounts } from './util';
const level = require('level-mem');

const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);

const rawDBOpts = { keyEncoding: 'binary', valueEncoding: 'binary' };

class MockTrieSyncBackend implements TrieSyncBackend {
  readonly rawdb: LevelUp;

  constructor(rawdb: LevelUp = level()) {
    this.rawdb = rawdb;
  }

  async batch(batch: DBOpData[]) {
    await this.rawdb.batch(batch as any);
  }

  async hasTrieNode(hash: Buffer): Promise<boolean> {
    try {
      await this.rawdb.get(hash, rawDBOpts);
      return true;
    } catch (err: any) {
      if (err.type === 'NotFoundError') {
        return false;
      }
      throw err;
    }
  }

  async hasCode(hash: Buffer): Promise<boolean> {
    try {
      await this.rawdb.get(hash, rawDBOpts);
      return true;
    } catch (err: any) {
      if (err.type === 'NotFoundError') {
        return false;
      }
      throw err;
    }
  }
}

describe('TrieSync', () => {
  const rawdb: LevelUp = level();
  const db = new Database(rawdb, common);
  let accounts!: AccountInfo[];
  let root!: Buffer;

  async function syncAndCheck(rawdb2?: LevelUp) {
    const backend = new MockTrieSyncBackend(rawdb2);

    const sync = new TrieSync(backend);
    await sync.init(root);

    while (sync.pending > 0) {
      const { nodeHashes, codeHashes } = sync.missing(3);
      for (const hash of nodeHashes) {
        await sync.process(hash, await rawdb.get(hash, rawDBOpts));
      }
      for (const hash of codeHashes) {
        await sync.process(hash, await rawdb.get(hash, rawDBOpts));
      }

      const batch = new BinaryRawDBatch(backend as any);
      sync.commit(batch);
      await batch.write();
      batch.reset();
    }

    for (const { address, code, account, storageData } of accounts) {
      const trie = new SecureTrie(backend.rawdb, root);
      const account2 = await trie.get(address);
      expect(account2 && account2.equals(account.serialize()), 'account should be equal').be.true;

      const code2 = await backend.rawdb.get(account.codeHash, rawDBOpts);
      expect(code2 && code2.equals(code), 'code should be equal').be.true;

      for (const [, { key, val }] of storageData) {
        const trie = new SecureTrie(backend.rawdb, account.stateRoot);
        const val2 = await trie.get(key);
        expect(val2 && val2.equals(val), 'storage value should be equal').be.true;
      }
    }
  }

  before(async () => {
    const result = await genRandomAccounts(db, 20, 20, false);
    accounts = result.accounts;
    root = result.root;
  });

  it("should sync trie succeed(when the whole tree doesn't exist)", async () => {
    await syncAndCheck();
  });

  it("should sync trie succeed(when some nodes don't exist)", async () => {
    const rawdb2: LevelUp = level();

    // copy whole tree
    for await (const { key, val } of new TrieIterator(new BaseTrie(rawdb, root))) {
      await rawdb2.put(key, val, rawDBOpts);
    }

    // ensure the root node is a branch node
    const trie = new BaseTrie(rawdb, root);
    const node = await trie._lookupNode(root);
    if (!(node instanceof BranchNode)) {
      throw new Error('the root node is not a branch node, please run test cases again');
    }

    // randomly pick a child branch
    const childNodes: (Buffer | Buffer[])[] = [];
    for (let i = 0; i < 16; i++) {
      const childNode = node.getBranch(i);
      if (childNode && childNode.length > 0) {
        childNodes.push(childNode);
      }
    }

    // delete the whole child branch
    const deleteNode = async (node: TrieNode) => {
      if (node instanceof BranchNode) {
        for (let i = 0; i < 16; i++) {
          const childNode = node.getBranch(i);
          if (childNode && childNode.length > 0) {
            const child = await trie._lookupNode(childNode);
            await deleteNode(child!);
          }
        }
      } else if (node instanceof ExtensionNode) {
        const child = await trie._lookupNode(node._value);
        await deleteNode(child!);
      }

      await rawdb2.del(node.hash(), rawDBOpts);
    };
    await deleteNode((await trie._lookupNode(childNodes[getRandomIntInclusive(0, childNodes.length - 1)]))!);

    await syncAndCheck(rawdb2);
  });
});
