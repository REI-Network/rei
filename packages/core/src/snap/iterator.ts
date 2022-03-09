import { LevelUp } from 'levelup';
import { AbstractLevelDOWN, AbstractIteratorOptions, AbstractIterator } from 'abstract-leveldown';
import { SnapIterator } from './types';

/**
 * Return an async generator to iterate hash list
 * @param hashes - Hash list
 * @param isStale - A function to check if a layer is stale
 * @param getValueByHash - A function to get value by hash
 */
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
type IteratorOptions = Pick<AbstractIteratorOptions<Buffer>, 'gte' | 'lte'>;

/**
 * Return an async generator to iterate all keys in db
 * @param db - Level db
 * @param options - Iterator options
 * @param skip - A function that checks if a key needs to be skipped
 * @param convertKey - A function to convert key
 * @param convertValue - A function to convert value
 */
export async function* asyncTraverseRawDB<T>(db: DB<Buffer, Buffer>, options: IteratorOptions, skip: (key: Buffer) => boolean, convertKey: (key: Buffer) => Buffer, convertValue: (value: Buffer) => T): SnapIterator<T> {
  const itr = db.iterator({
    ...options,
    keys: true,
    values: true,
    keyAsBuffer: true,
    keyEncoding: 'binary',
    valueAsBuffer: true,
    valueEncoding: 'binary'
  });
  try {
    while (true) {
      const result = await new Promise<[Buffer, Buffer] | void>((resolve, reject) => {
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

      const [key, value] = result;
      if (skip(key)) {
        continue;
      }

      yield {
        hash: convertKey(key),
        getValue: () => convertValue(value)
      };
    }
  } finally {
    itr.end(() => {});
  }
}
