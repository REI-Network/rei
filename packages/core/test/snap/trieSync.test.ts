import { expect } from 'chai';
import { LevelUp } from 'levelup';
import { SecureTrie } from 'merkle-patricia-tree';
import { Common } from '@rei-network/common';
import { Database, DBOpData } from '@rei-network/database';
import { RawDBatch } from '../../src/snap/batch';
import { TrieSync, TrieSyncBackend } from '../../src/snap/trieSync';
import { AccountInfo, genRandomAccounts } from './util';
const level = require('level-mem');

const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);

const rawDBOpts = { keyEncoding: 'binary', valueEncoding: 'binary' };

class MockTrieSyncBackend implements TrieSyncBackend {
  readonly rawdb: LevelUp = level();

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

  before(async () => {
    const result = await genRandomAccounts(db, 10, 10);
    accounts = result.accounts;
    root = result.root;
  });

  it('should sync trie succeed', async () => {
    const backend = new MockTrieSyncBackend();

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

      const batch = new RawDBatch(backend as any);
      sync.commit(batch);
      await batch.write();
      batch.reset();
    }

    for (const { address, account, storageData } of accounts) {
      const trie = new SecureTrie(backend.rawdb, root);
      const account2 = await trie.get(address);
      expect(account2 && account2.equals(account.serialize()), 'account should be equal').be.true;

      for (const [, { key, val }] of storageData) {
        const trie = new SecureTrie(backend.rawdb, account.stateRoot);
        const val2 = await trie.get(key);
        expect(val2 && val2.equals(val), 'storage value should be equal').be.true;
      }
    }
  });
});
