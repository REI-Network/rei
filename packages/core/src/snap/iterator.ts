import { LevelUp } from 'levelup';
import { AbstractLevelDOWN, AbstractIteratorOptions, AbstractIterator } from 'abstract-leveldown';
import { SnapIterator } from './types';

export async function* asyncTraverseHashList<T>(hashes: Buffer[], isStale: () => boolean, getValueByHash: (hash: Buffer) => T): SnapIterator<T> {
  while (hashes.length > 0) {
    if (isStale()) {
      break;
    }

    const hash = hashes.shift()!;
    yield {
      hash,
      getValue: () => getValueByHash(hash)
    };
  }
}

type DB<K, V> = LevelUp<AbstractLevelDOWN<K, V>, AbstractIterator<K, V>>;

export async function* asyncTraverseRawDB<T>(db: DB<Buffer, Buffer>, options: AbstractIteratorOptions<Buffer>, skip: (key: Buffer) => boolean, convertValue: (value: Buffer) => T): SnapIterator<T> {
  const itr = db.iterator(options);
  try {
    while (true) {
      const result = await new Promise<[Buffer, Buffer] | void>((resolve, reject) => {
        itr.next((err, key, val) => {
          if (err) {
            reject(err);
          }
          if (key === undefined || val === undefined) {
            resolve();
          }
          resolve([key, val]);
        });
      });

      if (!result) {
        break;
      }

      const [key, value] = result;
      if (skip(key)) {
        continue;
      }

      yield {
        hash: key,
        getValue: () => convertValue(value)
      };
    }
  } finally {
    itr.end(() => {});
  }
}
