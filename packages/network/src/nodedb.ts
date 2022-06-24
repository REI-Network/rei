import { LevelUp } from 'levelup';
import { AbstractLevelDOWN, AbstractIterator } from 'abstract-leveldown';
import { ENR } from '@gxchain2/discv5';
import * as crypto from "crypto";

type DB = LevelUp<AbstractLevelDOWN<Buffer, Buffer>, AbstractIterator<Buffer, Buffer>>;

const dbNodePrefix = "n:";
const dbDiscv5Root = "v5";
const dbNodeMessage = "lastMessage";

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
  itr.end(() => { });
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
  async load(onData: (data: { k, v }) => void) {
    const itr = this.db.iterator({ keys: true, values: true });
    for await (const [k, v] of iteratorToAsyncGenerator(itr)) {
      const { prefix, nodeId, discvRoot, ip, field } = this.splitNode(k);
      if (ip && field == dbNodeMessage) {
        onData({ k, v });
      }
      continue;
    }
  }


  del(key: Buffer) {
    return this.db.del(key);
  }

  async querySeeds1(n: number, maxAge: number, onData: (enrs: ENR[]) => void) {
    const enrs: ENR[] = [];
    const now = Date.now();
    const itr = this.db.iterator({ keys: true, values: true });
    for await (const [key, val] of iteratorToAsyncGenerator(itr)) {
      const { prefix, nodeId, discvRoot, ip, field } = this.splitNode(key);
      if (ip && field == dbNodeMessage) {
        if (now - parseInt(val.toString()) < maxAge) {
          enrs.push(ENR.decode(await this.db.get(Buffer.from(prefix + nodeId + discvRoot))));
          if (enrs.length >= n) {
            break;
          }
        }
      }
    }
    onData(enrs);
  }

  async querySeeds(n: number, maxAge: number, onData: (enrs: ENR[]) => void) {
    const enrs: ENR[] = [];
    const now = Date.now();
    const itr = this.db.iterator({ keys: true, values: true });
    seek: for (let seeks = 0; enrs.length < n && seeks < n * 5; seeks++) {
      const randomBytes = crypto.randomBytes(32);
      const data = await itr.seek(randomBytes);
      if (!data) {
        continue seek;
      }
      const [key, val] = data;
      const { prefix, nodeId, discvRoot, ip, field } = this.splitNode(key);
      if (!ip || field != dbNodeMessage) {
        continue seek;
      }
      if (now - parseInt(val.toString()) > maxAge) {
        continue seek;
      }
      for (let k in enrs) {
        if (enrs[k].nodeId === nodeId) {
          continue seek;
        }
      }
      enrs.push(ENR.decode(await this.db.get(Buffer.from(prefix + nodeId + discvRoot))));
    }
    onData(enrs);
  }

  async nextNode(itr: AsyncGenerator<Buffer, Buffer>) {
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
      return;
    }
    return result;
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
    this.db.put(Buffer.from(dbNodePrefix + nodeId + ":" + dbDiscv5Root + ":" + ip + ":" + dbNodeMessage), Buffer.from(Date.now().toString()));
  }

  nodeKey(enr: ENR): string {
    return dbNodePrefix + enr.nodeId + ":" + dbDiscv5Root;
  }

  nodeItemKey(enr: ENR, field: string): string {
    return this.nodeKey(enr) + ":" + enr.ip + ":" + field;
  }

  splitNode(buffer: Buffer) {
    const str = buffer.toString();
    const [prefix, nodeId, discvRoot, ip, field] = str.split(":");
    return { prefix, nodeId, discvRoot, ip, field };
  }
}