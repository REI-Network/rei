import * as crypto from 'crypto';
import { LevelUp } from 'levelup';
import PeerId from 'peer-id';
import { AbstractLevelDOWN, AbstractIterator } from 'abstract-leveldown';
import { ENR } from '@gxchain2/discv5';

type DB = LevelUp<
  AbstractLevelDOWN<Buffer, Buffer>,
  AbstractIterator<Buffer, Buffer>
>;

// These fields are stored per ID and IP, the full key is "n:<ID>:v5:<IP>:findfail".
// Use nodeItemKey to create those keys.
const dbNodePrefix = 'n:';
const dbLocalprefix = 'local:';
const dbDiscv5Root = 'v5';
const dbNodePong = 'lastPong';
// Local information is keyed by ID only, the full key is "local:<ID>:seq".
// Use localItemKey to create those keys.
const dbLocalSeq = 'seq';

async function* iteratorToAsyncGenerator<K, V>(
  itr: AbstractIterator<K, V>,
  release: boolean
) {
  while (true) {
    const result = await new Promise<[K, V] | void>((resolve, reject) => {
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
   * @param seedMaxAge - the maximum age of a seed nodes
   * @param onDelete - On delete callback
   */
  async checkTimeout(seedMaxAge: number, onDelete?: (peerId: PeerId) => void) {
    const now = Date.now();
    const itr = this.db.iterator({ keys: true, values: true });
    for await (const [k, v] of iteratorToAsyncGenerator(itr, true)) {
      const { nodeId, ip, field } = this.splitNodeItemKey(k);
      if (ip && field === dbNodePong) {
        if (now - parseInt(v.toString()) > seedMaxAge) {
          const enr = await this._deleteRange(this._nodeKey(nodeId));
          if (enr && onDelete) {
            onDelete(await enr.peerId());
          }
        }
      }
    }
  }

  /**
   * retrieves random nodes to be used as potential seed nodes for bootstrapping.
   * @param numNodes - the number of nodes to retrieve
   * @param seedMaxAge - the maximum age of a seed nodes
   */
  async querySeeds(numNodes: number, maxAge: number) {
    const enrs: ENR[] = [];
    const now = Date.now();
    const itr = this.db.iterator({ keys: true, values: true });
    let id: Buffer = Buffer.alloc(32);
    for (
      let seeks = 0;
      enrs.length < numNodes && seeks < numNodes * 5;
      seeks++
    ) {
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
      let include = false;
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
   * @param enr - the enr to persist
   */
  persist(enr: ENR) {
    return this.db.put(Buffer.from(this.nodeKey(enr)), enr.encode());
  }

  /**
   * Put the node timestamp into the database
   * @param nodeId - the node id
   * @param ip - the node ip
   */
  updatePongMessage(nodeId: string, ip: string, timestamp = Date.now()) {
    return this.db.put(
      Buffer.from(this._nodeItemKey(nodeId, ip, dbNodePong)),
      Buffer.from(timestamp.toString())
    );
  }

  /**
   * Get the nodeKey by the enr
   * @param enr - the enr to get the nodeKey
   * @returns the nodeKey
   */
  nodeKey(enr: ENR): string {
    return dbNodePrefix + [enr.nodeId, dbDiscv5Root].join(':');
  }

  /**
   * Get the nodeItemKey by the enr and field
   * @param enr - the enr to get the nodeItemKey
   * @param field - the field of the nodeItemKey
   * @returns the nodeItemKey
   */
  nodeItemKey(enr: ENR, field: string): string {
    return [this.nodeKey(enr), enr.ip, field].join(':');
  }

  /**
   * Split the nodeKey into nodeId and rest
   * @param key - the nodeKey
   * @returns the nodeId and rest
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
   * @param key - the nodeItemKey
   * @returns the nodeId, ip and field
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
   * @param nodeId - the node id
   * @param ip - the node ip
   * @returns the last pong message timestamp
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
   * @param key - the key to seek to
   * @param itr - the iterator to seek
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
   * @param nodeId - the local node id
   * @param field - the field of the local node item
   */
  localItemKey(nodeId: string, field: string) {
    return dbLocalprefix + [nodeId, field].join(':');
  }

  /**
   * Stores the local enr sequence counter
   * @param nodeId - the local node id
   * @param {bigint} seq - the local enr sequence counter
   */
  storeLocalSeq(nodeId: string, seq: bigint) {
    return this.db.put(
      Buffer.from(this.localItemKey(nodeId, dbLocalSeq)),
      Buffer.from(seq.toString())
    );
  }

  /**
   * Retrieves the local enr sequence counter, defaulting to the current
   * @param nodeId - the local node id
   * @returns the local enr sequence counter
   */
  async localSeq(nodeId: string) {
    try {
      const value = await this.db.get(
        Buffer.from(this.localItemKey(nodeId, dbLocalSeq))
      );
      return BigInt(value.toString());
    } catch (e) {
      if ((e as any).type === 'NotFoundError') {
        return BigInt(Date.now());
      }
      throw e;
    }
  }

  /**
   * Get the next node info from the iterator
   * @param itr - the iterator to get the next node info
   * @returns the next node info
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
   * @param nodeId - the node id
   * @returns the nodeKey
   */
  private _nodeKey(nodeId: string) {
    return dbNodePrefix + [nodeId, dbDiscv5Root].join(':');
  }

  /**
   * Get the nodeItemKey by the nodeId and field
   * @param nodeId - the node id
   * @param field - the field of the nodeItemKey
   * @returns the nodeItemKey
   */
  private _nodeItemKey(nodeId: string, ip: string, field: string) {
    return [this._nodeKey(nodeId), ip, field].join(':');
  }

  /**
   * Tests whether the byte slice key begins with prefix
   * @param key - the key to test
   * @param prefix - the prefix to test
   * @returns true if the key begins with prefix
   */
  private _hasPrefix(key: Buffer, prefix: Buffer) {
    return (
      key.length >= prefix.length && key.slice(0, prefix.length).equals(prefix)
    );
  }

  /**
   * Delete all the entry in the database with the given prefix
   * @param prefix - the prefix to delete
   */
  private async _deleteRange(prefix: string) {
    let enr: ENR | undefined;
    const range = this._bytesPrefix(prefix);
    const itr = this.db.iterator({
      keys: true,
      values: true,
      gte: range.prefixBuffer,
      lte: range.limit
    });
    for await (const [key, val] of iteratorToAsyncGenerator(itr, true)) {
      const { rest } = this.splitNodeKey(key);
      if (rest.toString() === dbDiscv5Root) {
        enr = ENR.decode(val);
      }
      await this.db.del(key);
    }
    return enr;
  }

  /**
   * Returns key range that satisfy the given prefix.
   * @param prefix - the prefix to test
   * @returns the key range
   */
  private _bytesPrefix(prefix: string) {
    let limit: Buffer = Buffer.alloc(prefix.length);
    const prefixBuffer = Buffer.from(prefix);
    for (let i = prefixBuffer.length - 1; i >= 0; i--) {
      const c = prefixBuffer[i];
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
