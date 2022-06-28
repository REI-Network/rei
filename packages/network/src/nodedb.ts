import { LevelUp } from 'levelup';
import { AbstractLevelDOWN, AbstractIterator } from 'abstract-leveldown';
import { ENR } from '@gxchain2/discv5';
import * as crypto from 'crypto';

type DB = LevelUp<AbstractLevelDOWN<Buffer, Buffer>, AbstractIterator<Buffer, Buffer>>;

const dbNodePrefix = 'n:';
const dbDiscv5Root = 'v5';
const dbNodeMessage = 'lastMessage';

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
    } catch (err: any) {
      if (err.type === 'NotFoundError') {
        return;
      }
      throw err;
    }
  }

  /**
   * Load all remote node enr information
   */
  async checkTimeout(seedMaxAge: number) {
    const now = Date.now();
    const itr = this.db.iterator({ keys: true, values: true });
    for await (const [k, v] of iteratorToAsyncGenerator(itr)) {
      const { ip, field } = this.splitNode(k);
      if (ip && field === dbNodeMessage) {
        if (now - parseInt(v.toString()) > seedMaxAge) {
          await this.del(k);
        }
      }
    }
  }

  del(key: Buffer) {
    return this.db.del(key);
  }

  async querySeeds(n: number, maxAge: number) {
    const enrs: ENR[] = [];
    const now = Date.now();
    const itr = this.db.iterator({ keys: true, values: true });
    let randomBytes: Buffer = Buffer.alloc(32);
    for (let seeks = 0; enrs.length < n && seeks < n * 5; seeks++) {
      // Seek to a random entry. The first byte is incremented by a
      // random amount each time in order to increase the likelihood
      // of hitting all existing nodes in very small databases.
      const ctr = randomBytes[0];
      randomBytes = crypto.randomBytes(32);
      randomBytes[0] = ctr + (randomBytes[0] % 16);
      const data = await this.seek(randomBytes, dbNodeMessage, itr);
      if (!data) {
        continue;
      }
      const [key, val] = data;
      const { prefix, nodeId, discvRoot } = this.splitNode(key);
      if (now - parseInt(val.toString()) > maxAge) {
        continue;
      }
      let include: boolean = false;
      for (const enr of enrs) {
        if (enr.nodeId === nodeId) {
          include = true;
          break;
        }
      }
      if (!include) {
        enrs.push(ENR.decode(await this.db.get(Buffer.from(prefix + [nodeId, discvRoot].join(':')))));
      }
    }
    return enrs;
  }

  /**
   * Persist local node enr information
   */
  persistLocal(enr: ENR, privateKey: Buffer) {
    return this.db.put(Buffer.from('local'), enr.encode(privateKey));
  }

  /**
   * Persist remote node enr information
   */
  persist(enr: ENR) {
    this.db.put(Buffer.from(this.nodeKey(enr)), enr.encode());
  }

  putReceived(nodeId: string, ip: string) {
    return this.db.put(Buffer.from(dbNodePrefix + [nodeId, dbDiscv5Root, ip, dbNodeMessage].join(':')), Buffer.from(Date.now().toString()));
  }

  nodeKey(enr: ENR): string {
    return dbNodePrefix + [enr.nodeId, dbDiscv5Root].join(':');
  }

  nodeItemKey(enr: ENR, field: string): string {
    return [this.nodeKey(enr), enr.ip, field].join(':');
  }

  splitNode(buffer: Buffer) {
    const str = buffer.toString();
    const [prefix, nodeId, discvRoot, ip, field] = str.split(':');
    return { prefix, nodeId, discvRoot, ip, field };
  }

  async seek(randomBytes: Buffer, f: string, itr: AbstractIterator<Buffer, Buffer>) {
    for await (const [key, val] of iteratorToAsyncGenerator(itr)) {
      if (key.compare(randomBytes) > 0) {
        const { ip, field } = this.splitNode(key);
        if (ip && field === f) {
          return [key, val];
        }
      }
    }
  }
}
