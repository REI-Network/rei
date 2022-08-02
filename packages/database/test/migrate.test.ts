import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { migrate } from '../src/migrate';
import { createEncodingLevelDB, createLevelDB, createEncodingRocksDB, createRocksDB } from '../src/rawdb';
import { expect } from 'chai';

const testDir = path.join(__dirname, 'testdir');
const fromDir = path.join(testDir, 'from');
const toDir = path.join(testDir, 'to');

async function testMigrate(fromCreator: typeof createEncodingLevelDB | typeof createLevelDB, toCreator: typeof createEncodingRocksDB | typeof createRocksDB) {
  const from = fromCreator(fromDir);
  const to = toCreator(toDir);
  try {
    const keys: Buffer[] = [];
    const vals: Buffer[] = [];
    for (let i = 0; i < 100; i++) {
      const key = crypto.randomBytes(32);
      const val = crypto.randomBytes(32);
      keys.push(key);
      vals.push(val);
      await from.put(key, val, { keyEncoding: 'binary', valueEncoding: 'binary' });
    }
    await migrate(from, to);
    for (let i = 0; i < keys.length; i++) {
      const val2 = await to.get(keys[i], { keyEncoding: 'binary', valueEncoding: 'binary' });
      expect(vals[i].equals(val2 as any), 'value should be equal');
    }
  } finally {
    await from.close();
    await to.close();
  }
}

describe('Migrate', () => {
  beforeEach(() => {
    fs.mkdirSync(fromDir, { recursive: true });
    fs.mkdirSync(toDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmdirSync(testDir, { recursive: true });
  });

  it('should migrate leveldb to rocksdb succeed', async () => {
    await testMigrate(createLevelDB, createRocksDB);
  });

  it('should migrate encoding leveldb to encoding rocksdb succeed', async () => {
    await testMigrate(createEncodingLevelDB, createEncodingRocksDB);
  });
});
