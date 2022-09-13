import { LevelUp } from 'levelup';

async function* asyncTraversal(db: LevelUp) {
  const itr = db.iterator({ keyEncoding: 'binary', valueEncoding: 'binary' });
  while (true) {
    const result = await new Promise<[any, any] | void>((resolve, reject) => {
      itr.next((err, key, val) => {
        if (err) {
          reject(err);
        } else if (key === undefined || val === undefined) {
          resolve();
        } else {
          resolve([key, val]);
        }
      });
    });
    if (!result) {
      break;
    }
    yield result;
  }
  itr.end(() => {});
}

/**
 * Migrate leveldb to rocksdb
 * @param from - Leveldb instance
 * @param to - Rocksdb instance
 */
export async function migrate(from: LevelUp, to: LevelUp) {
  for await (const [key, val] of asyncTraversal(from)) {
    await to.put(key, val, { keyEncoding: 'binary', valueEncoding: 'binary' });
  }
}

/**
 * Batch migrate leveldb to rocksdb
 * @param dbs - Leveldb and Rocksdb instance list
 */
export async function batchMigrate(dbs: [LevelUp, LevelUp][]) {
  await Promise.all(dbs.map(([db0, db1]) => migrate(db0, db1)));
}
