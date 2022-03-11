import crypto from 'crypto';
import { expect } from 'chai';
import { BaseTrie as Trie } from 'merkle-patricia-tree';
import { FunctionalBufferMap } from '@rei-network/utils';
import { Database } from '@rei-network/database';
import { Common } from '@rei-network/common';
import { TrieIterator } from '../../src/snap/trieIterator';
const level = require('level-mem');

const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);

describe('TrieIterator', () => {
  const db = new Database(level(), common);
  const trie = new Trie(db.rawdb);
  const kv = new FunctionalBufferMap<Buffer>();

  before(async () => {
    for (let i = 0; i < 100; i++) {
      const key = crypto.randomBytes(32);
      const val = crypto.randomBytes(32);
      await trie.put(key, val);
      kv.set(key, val);
    }
  });

  it('should trie succeed', async () => {
    for await (const { key, val } of new TrieIterator(trie)) {
      const _val = kv.get(key);
      expect(_val !== undefined, 'key should exist').be.true;
      expect(_val!.equals(val), 'value should be equal').be.true;
      kv.delete(key);
    }
    expect(kv.size === 0, 'kv should be empty').be.true;
  });
});
