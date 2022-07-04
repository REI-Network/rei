import { LevelUp } from 'levelup';
import { AbstractLevelDOWN, AbstractIterator } from 'abstract-leveldown';
import { ENR } from '@gxchain2/discv5';
import * as crypto from 'crypto';

type DB = LevelUp<AbstractLevelDOWN<Buffer, Buffer>, AbstractIterator<Buffer, Buffer>>;

// These fields are stored per ID and IP, the full key is "n:<ID>:v5:<IP>:findfail".
// Use nodeItemKey to create those keys.
const dbNodePrefix = 'n:';
const dbLocalprefix = 'local:';
const dbDiscv5Root = 'v5';
const dbNodePong = 'lastPong';
// Local information is keyed by ID only, the full key is "local:<ID>:seq".
// Use localItemKey to create those keys.
const dbLocalSeq = 'seq';

async function* iteratorToAsyncGenerator<K, V>(itr: AbstractIterator<K, V>, release: boolean) {
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
  if (release) itr.end(() => {});
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
   * Traverse all node timestamps in the database and delete the data about the timeout node
   * @param {number} seedMaxAge - the maximum age of a seed nodes
   */
  async checkTimeout(seedMaxAge: number) {
    const now = Date.now();
    const itr = this.db.iterator({ keys: true, values: true });
    for await (const [k, v] of iteratorToAsyncGenerator(itr, true)) {
      const { nodeId, ip, field } = this.splitNodeItemKey(k);
      if (ip && field === dbNodePong) {
        if (now - parseInt(v.toString()) > seedMaxAge) {
          await this._deleteRange(this._nodeKey(nodeId));
        }
      }
    }
  }

  /**
   * retrieves random nodes to be used as potential seed nodes for bootstrapping.
   * @param {number} numNodes - the number of nodes to retrieve
   * @param {number} seedMaxAge - the maximum age of a seed nodes
   */
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
   * @param {ENR} enr - the enr to persist
   */
  persist(enr: ENR) {
    return this.db.put(Buffer.from(this.nodeKey(enr)), enr.encode());
  }

  /**
   * Put the node timestamp into the database
   * @param {string} nodeId - the node id
   * @param {string} ip - the node ip
   */
  putReceived(nodeId: string, ip: string) {
    return this.db.put(Buffer.from(this._nodeItemKey(nodeId, ip, dbNodePong)), Buffer.from(Date.now().toString()));
  }

  /**
   * Get the nodeKey by the enr
   * @param {ENR} enr - the enr to get the nodeKey
   * @returns {string} the nodeKey
   */
  nodeKey(enr: ENR): string {
    return dbNodePrefix + [enr.nodeId, dbDiscv5Root].join(':');
  }

  /**
   * Get the nodeItemKey by the enr and field
   * @param {ENR} enr - the enr to get the nodeItemKey
   * @param {string} field - the field of the nodeItemKey
   * @returns {string} the nodeItemKey
   */
  nodeItemKey(enr: ENR, field: string): string {
    return [this.nodeKey(enr), enr.ip, field].join(':');
  }

  /**
   * Split the nodeKey into nodeId and rest
   * @param {Buffer} key - the nodeKey
   * @returns {object} the nodeId and rest
   */
  splitNodeKey(key: Buffer) {
    if (!this._hasPrefix(key, Buffer.from(dbNodePrefix))) {
      return { nodeId: '', rest: Buffer.alloc(0) };
    }
    const item = key.slice(dbNodePrefix.length);
    const nodeId = item.slice(0, 64).toString();
    return { nodeId, rest: item.slice(64 + 1) };
  }
  /**
   * Split the nodeItemKey into nodeId, ip and field
   * @param {Buffer} key - the nodeItemKey
   * @returns {object} the nodeId, ip and field
   */
  splitNodeItemKey(key: Buffer) {
    const { nodeId, rest } = this.splitNodeKey(key);
    if (rest.toString() === dbDiscv5Root) {
      return { nodeId };
    }
    const itemKey = rest.slice(dbDiscv5Root.length + 1);
    const [ip, field] = itemKey.toString().split(':');
    return { nodeId, ip, field };
  }

  /**
   * Get the last pong message timestamp of the node
   * @param {string} nodeId - the node id
   * @param {string} ip - the node ip
   * @returns {Promise<number>} the last pong message timestamp
   */
  async lastPongReceived(nodeId: string, ip: string) {
    const key = this._nodeItemKey(nodeId, ip, dbNodePong);
    try {
      const value = await this.db.get(Buffer.from(key));
      return value ? parseInt(value.toString()) : 0;
    } catch (e) {
      if ((e as any).type == 'NotFoundError') {
        return 0;
      }
      throw e;
    }
  }

  /**
   * Seek moves the iterator to the first key/value pair whose key is greater than or equal to the given key.
   * @param {Buffer} key - the key to seek to
   * @param {Iterator} itr - the iterator to seek
   */
  async seek(randomBytes: Buffer, itr: AbstractIterator<Buffer, Buffer>) {
    for await (const [key] of iteratorToAsyncGenerator(itr, false)) {
      if (key.compare(randomBytes) >= 0) {
        return;
      }
    }
  }

  /**
   * Returns the key of a local node item
   * @param {string} nodeId - the local node id
   * @param {string} field - the field of the local node item
   */
  localItemKey(nodeId: string, field: string) {
    return dbLocalprefix + [nodeId, field].join(':');
  }

  /**
   * Stores the local enr sequence counter
   * @param {string} nodeId - the local node id
   * @param {bigint} seq - the local enr sequence counter
   */
  storeLocalSeq(nodeId: string, seq: bigint) {
    return this.db.put(Buffer.from(this.localItemKey(nodeId, dbLocalSeq)), Buffer.from(seq.toString()));
  }

  /**
   * Retrieves the local enr sequence counter, defaulting to the current
   * @param {string} nodeId - the local node id
   * @returns {Promise<bigint>} the local enr sequence counter
   */
  async localSeq(nodeId: string) {
    try {
      const value = await this.db.get(Buffer.from(this.localItemKey(nodeId, dbLocalSeq)));
      return BigInt(value.toString());
    } catch (e) {
      if ((e as any).type == 'NotFoundError') {
        return BigInt(0);
      }
      throw e;
    }
  }

  /**
   * Get the next node info from the iterator
   * @param {Iterator} itr - the iterator to get the next node info
   * @returns {Promise<ENR>} the next node info
   */
  async nextNode(itr: AbstractIterator<Buffer, Buffer>) {
    for await (const [key, val] of iteratorToAsyncGenerator(itr, false)) {
      const { rest } = this.splitNodeKey(key);
      if (rest.toString() !== dbDiscv5Root) {
        continue;
      }
      return ENR.decode(val);
    }
  }

  /**
   * Get the nodeKey by the nodeId
   * @param {string} nodeId - the node id
   * @returns {string} the nodeKey
   */
  private _nodeKey(nodeId: string) {
    return dbNodePrefix + [nodeId, dbDiscv5Root].join(':');
  }

  /**
   * Get the nodeItemKey by the nodeId and field
   * @param {string} nodeId - the node id
   * @param {string} field - the field of the nodeItemKey
   * @returns {string} the nodeItemKey
   */
  private _nodeItemKey(nodeId: string, ip: string, field: string) {
    return [this._nodeKey(nodeId), ip, field].join(':');
  }

  /**
   * Tests whether the byte slice key begins with prefix
   * @param {Buffer} key - the key to test
   * @param {Buffer} prefix - the prefix to test
   * @returns {boolean} true if the key begins with prefix
   */
  private _hasPrefix(key: Buffer, prefix: Buffer) {
    return key.length >= prefix.length && key.slice(0, prefix.length).equals(prefix);
  }

  /**
   * Delete all the entry in the database with the given prefix
   * @param {Buffer} prefix - the prefix to delete
   */
  private async _deleteRange(prefix: string) {
    const range = this._bytesPrefix(prefix);
    const itr = this.db.iterator({ keys: true, gte: range.prefixBuffer, lte: range.limit });
    for await (const [key] of iteratorToAsyncGenerator(itr, true)) {
      await this.db.del(key);
    }
  }

  /**
   * Returns key range that satisfy the given prefix.
   * @param {string} prefix - the prefix to test
   * @returns {object} the key range
   */
  private _bytesPrefix(prefix: string) {
    let limit: Buffer = Buffer.alloc(prefix.length);
    let prefixBuffer = Buffer.from(prefix);
    for (let i = prefixBuffer.length - 1; i >= 0; i--) {
      let c = prefixBuffer[i];
      if (c < 0xff) {
        limit = Buffer.alloc(i + 1);
        prefixBuffer.copy(limit);
        limit[i] = c + 1;
        break;
      }
    }
    return { prefixBuffer, limit };
  }
}
