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

export async function migrate(from: LevelUp, to: LevelUp) {
  console.log('migrate start');
  try {
    for await (const [key, val] of asyncTraversal(from)) {
      await to.put(key, val, { keyEncoding: 'binary', valueEncoding: 'binary' });
    }
  } catch (err) {
    console.log('migrate catch error:', err);
  } finally {
    console.log('migrate end');
  }
}
