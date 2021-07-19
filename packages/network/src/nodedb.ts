import { LevelUp } from 'levelup';
import { AbstractLevelDOWN, AbstractIterator } from 'abstract-leveldown';
import { ENR } from '@gxchain2/discv5';

type DB = LevelUp<AbstractLevelDOWN<Buffer, Buffer>, AbstractIterator<Buffer, Buffer>>;

async function* iteratorToAsyncGenerator<K, V>(itr: AbstractIterator<K, V>) {
  while (true) {
    const result = await new Promise<[K, V] | void>((resolve, reject) => {
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
    yield result;
  }
  itr.end(() => {});
}

/**
 * A simple database class for persisting and loading enr information
 */
export class NodeDB {
  private db: DB;

  constructor(db: DB) {
    this.db = db;
  }

  /**
   * Load local node enr information
   */
  async loadLocal() {
    try {
      return ENR.decode(await this.db.get(Buffer.from('local')));
    } catch (err) {
      if (err.type === 'NotFoundError') {
        return;
      }
      throw err;
    }
  }

  /**
   * Load all remote node enr information
   */
  async load(onData: (enr: ENR) => void) {
    const itr = this.db.iterator({ keys: true, values: true });
    for await (const [nodeId, serialized] of iteratorToAsyncGenerator(itr)) {
      const enr = ENR.decode(serialized);
      if (enr.nodeId === nodeId.toString()) {
        onData(enr);
      }
    }
  }

  /**
   * Persist local node enr information
   */
  persistLocal(enr: ENR, privateKey?: Buffer) {
    return this.db.put(Buffer.from('local'), enr.encode(privateKey));
  }

  /**
   * Persist remote node enr information
   */
  persist(enr: ENR) {
    return this.db.put(Buffer.from(enr.nodeId), enr.encode());
  }
}
