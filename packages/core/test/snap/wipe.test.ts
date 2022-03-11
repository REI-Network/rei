import crypto from 'crypto';
import { Database } from '@rei-network/database';
import { Common } from '@rei-network/common';
import { wipeKeyRange } from '../../src/snap/utils';
import { EMPTY_HASH, MAX_HASH } from '../../src/utils';
import { asyncTraverseRawDB } from '../../src/snap';
import { expect } from 'chai';
const level = require('level-mem');

const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);

class DBOp {
  baseDBOp!: {
    type?: String;
    key: Buffer | string;
    keyEncoding: String;
    valueEncoding?: String;
    value?: string | Buffer | object;
  };

  updateCache() {}
}

describe('WipeKeyRange', () => {
  const db = new Database(level(), common);
  const prefix1 = Buffer.from('1');
  const prefix2 = Buffer.from('2');

  async function putRandomValues(prefix: Buffer) {
    for (let i = 0; i < 100; i++) {
      const key = crypto.randomBytes(32);
      const val = crypto.randomBytes(32);
      await db.rawdb.put(Buffer.concat([prefix, key]), val);
    }
  }

  async function wipe(prefix: Buffer) {
    let deleted = 0;
    await wipeKeyRange(
      db,
      EMPTY_HASH,
      MAX_HASH,
      (origin, limit) =>
        asyncTraverseRawDB(
          db.rawdb,
          { gte: Buffer.concat([prefix, origin]), lte: Buffer.concat([prefix, limit]) },
          (key) => key.length !== prefix.length + 32,
          (key) => key.slice(prefix.length),
          (value) => value
        ),
      (hash: Buffer) => {
        deleted++;
        const op = new DBOp();
        op.baseDBOp = {
          type: 'del',
          key: hash,
          keyEncoding: 'binary',
          valueEncoding: 'binary'
        };
        return op as any;
      }
    );
    return deleted;
  }

  before(async () => {
    await putRandomValues(prefix1);
    await putRandomValues(prefix2);
  });

  it('should wipe succeed(1)', async () => {
    const deleted = await wipe(prefix1);
    expect(deleted, 'should delete 100 values').be.equal(100);
  });

  it('should wipe succeed(2)', async () => {
    const deleted = await wipe(prefix2);
    expect(deleted, 'should delete 100 values').be.equal(100);
  });
});
