import { LevelUp } from 'levelup';
import { AbstractLevelDOWN, AbstractIterator } from 'abstract-leveldown';
import { ENR } from '@gxchain2/discv5';
import * as crypto from 'crypto';

type DB = LevelUp<AbstractLevelDOWN<Buffer, Buffer>, AbstractIterator<Buffer, Buffer>>;

const dbNodePrefix = 'n:';
const dbLocalprefix = 'local:';
const dbDiscv5Root = 'v5';
const dbNodePong = 'lastPong';
// Local information is keyed by ID only, the full key is "local:<ID>:seq".
// Use localItemKey to create those keys.
const dbLocalSeq = 'seq';
//@todo release itreator when done
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
   * Load all remote node enr information
   */
  async checkTimeout(seedMaxAge: number) {
    const now = Date.now();
    const itr = this.db.iterator({ keys: true, values: true });
    for await (const [k, v] of iteratorToAsyncGenerator(itr)) {
      const { nodeId, ip, field } = this.splitNodeItemKey(k);
      if (ip && field === dbNodePong) {
        if (now - parseInt(v.toString()) > seedMaxAge) {
          await this._deleteRange(this._nodeKey(nodeId));
        }
      }
    }
  }

  async querySeeds(n: number, maxAge: number) {
    const enrs: ENR[] = [];
    const now = Date.now();
    const itr = this.db.iterator({ keys: true, values: true });
    let id: Buffer = Buffer.alloc(32);
    for (let seeks = 0; enrs.length < n && seeks < n * 5; seeks++) {
      // Seek to a random entry. The first byte is incremented by a
      // random amount each time in order to increase the likelihood
      // of hitting all existing nodes in very small databases.
      const ctr = id[0];
      id = crypto.randomBytes(32);
      id[0] = ctr + (id[0] % 16);
      await this.seek(Buffer.from(this._nodeKey(id.toString('hex'))), itr);
      const enr = await this.nextNode(itr);
      if (!enr) {
        id[0] = 0;
        continue; // iterator exhausted
      }
      if (now - (await this.lastPongReceived(enr.nodeId, enr.ip!)) > maxAge) {
        continue;
      }
      let include: boolean = false;
      for (const e of enrs) {
        if (e.nodeId === enr.nodeId) {
          include = true;
          break;
        }
      }
      if (!include) {
        enrs.push(enr);
      }
    }
    return enrs;
  }

  /**
   * Persist remote node enr information
   */
  persist(enr: ENR) {
    return this.db.put(Buffer.from(this.nodeKey(enr)), enr.encode());
  }

  putReceived(nodeId: string, ip: string) {
    return this.db.put(Buffer.from(this._nodeItemKey(nodeId, ip, dbNodePong)), Buffer.from(Date.now().toString()));
  }

  nodeKey(enr: ENR): string {
    return dbNodePrefix + [enr.nodeId, dbDiscv5Root].join(':');
  }

  nodeItemKey(enr: ENR, field: string): string {
    return [this.nodeKey(enr), enr.ip, field].join(':');
  }

  splitNodeKey(key: Buffer) {
    if (!this._hasPrefix(key, Buffer.from(dbNodePrefix))) {
      return { nodeId: '', rest: '' };
    }
    const item = key.slice(dbNodePrefix.length);
    const nodeId = item.slice(0, 32).toString('hex');
    return { nodeId, rest: item.slice(32) };
  }

  splitNodeItemKey(key: Buffer) {
    const { nodeId, rest } = this.splitNodeKey(key);
    if (rest.toString() === dbDiscv5Root) {
      return { nodeId };
    }
    const itemKey = rest.slice(dbDiscv5Root.length);
    const [ip, field] = itemKey.toString().split(':');
    return { nodeId, ip, field };
  }

  async lastPongReceived(nodeId: string, ip: string) {
    const key = this._nodeItemKey(nodeId, ip, dbNodePong);
    const value = await this.db.get(Buffer.from(key));
    return value ? parseInt(value.toString()) : 0;
  }

  async seek(randomBytes: Buffer, itr: AbstractIterator<Buffer, Buffer>) {
    for await (const [key] of iteratorToAsyncGenerator(itr)) {
      if (key.compare(randomBytes) >= 0) {
        return;
      }
    }
  }

  localItemKey(nodeId: string, field: string) {
    return dbLocalprefix + [nodeId, field].join(':');
  }

  storeLocalSeq(nodeId: string, n: bigint) {
    return this.db.put(Buffer.from(this.localItemKey(nodeId, dbLocalSeq)), Buffer.from(n.toString()));
  }

  async localSeq(nodeId: string) {
    const seq = await this.db.get(Buffer.from(this.localItemKey(nodeId, dbLocalSeq)));
    return seq ? BigInt(seq.toString()) : BigInt(Date.now());
  }

  private async nextNode(itr: AbstractIterator<Buffer, Buffer>) {
    for await (const [key, val] of iteratorToAsyncGenerator(itr)) {
      const { rest } = this.splitNodeKey(key);
      if (rest.toString() !== dbDiscv5Root) {
        continue;
      }
      return ENR.decode(val);
    }
  }

  private _nodeKey(nodeId: string) {
    return dbNodePrefix + [nodeId, dbDiscv5Root].join(':');
  }

  private _nodeItemKey(nodeId: string, ip: string, field: string) {
    return [this._nodeKey(nodeId), ip, field].join(':');
  }

  private _hasPrefix(key: Buffer, prefix: Buffer) {
    return key.length >= prefix.length && key.slice(0, prefix.length).equals(prefix);
  }

  private async _deleteRange(prefix: string) {
    //@todo gte lte
    const itr = this.db.iterator({ keys: true });
    for await (const [key] of iteratorToAsyncGenerator(itr)) {
      //del
      if (this._hasPrefix(key, Buffer.from(prefix))) {
        await this.db.del(key);
      }
    }
  }
}
