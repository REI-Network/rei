import Heap from 'qheap';
import { KECCAK256_NULL, KECCAK256_RLP } from 'ethereumjs-util';
import { BranchNode, ExtensionNode, LeafNode, Nibbles, TrieNode, isRawNode, decodeRawNode, decodeNode } from 'merkle-patricia-tree/dist/trieNode';
import { nibblesToBuffer } from 'merkle-patricia-tree/dist/util/nibbles';
import { FunctionalBufferMap } from '@rei-network/utils';
import { nibblesToTransportNibbles, TransportNibbles } from './nibbles';
import { RawDBatch } from './batch';

type LeafCallback = (paths: Buffer[], path: Nibbles, leaf: Buffer, parent: Buffer) => Promise<void>;

type SyncRequest = {
  path?: Nibbles;
  hash: Buffer;
  data?: Buffer;
  code: boolean;
  parent: SyncRequest[];
  deps: number;
  callback?: LeafCallback;
};

function toTransportNibbles(path: Nibbles): TransportNibbles[] {
  if (path.length < 64) {
    return [nibblesToTransportNibbles(path)];
  }
  return [nibblesToTransportNibbles(path.slice(0, 64)), nibblesToTransportNibbles(path.slice(64))];
}

class SyncMemBatch {
  readonly nodes = new FunctionalBufferMap<Buffer>();
  readonly codes = new FunctionalBufferMap<Buffer>();

  putNode(key: Buffer, value: Buffer) {
    this.nodes.set(key, value);
  }

  putCode(key: Buffer, value: Buffer) {
    this.codes.set(key, value);
  }

  hasNode(key: Buffer) {
    return this.nodes.has(key);
  }

  hasCode(key: Buffer) {
    return this.codes.has(key);
  }

  clear() {
    this.nodes.clear();
    this.codes.clear();
  }
}

export interface TrieSyncBackend {
  hasTrieNode(hash: Buffer): Promise<boolean>;
  hasCode(hash: Buffer): Promise<boolean>;
}

export class TrieSync {
  private readonly backend: TrieSyncBackend;
  private readonly memBatch = new SyncMemBatch();
  private readonly nodeReqs = new FunctionalBufferMap<SyncRequest>();
  private readonly codeReqs = new FunctionalBufferMap<SyncRequest>();
  private readonly queue = new Heap({
    compar: (a: SyncRequest, b: SyncRequest) => {
      let res = (a.path?.length ?? 0) - (b.parent?.length ?? 0);
      if (res === 0) {
        res = a.hash.compare(b.hash);
      }
      return res;
    }
  });

  constructor(backend: TrieSyncBackend) {
    this.backend = backend;
  }

  get pending() {
    return this.nodeReqs.size + this.codeReqs.size;
  }

  async addSubTrie(hash: Buffer, path?: Nibbles, parent?: Buffer, callback?: LeafCallback) {
    if (hash.equals(KECCAK256_RLP)) {
      return;
    }

    if (this.memBatch.hasNode(hash)) {
      return;
    }

    if (await this.backend.hasTrieNode(hash)) {
      return;
    }

    const parentReqs: SyncRequest[] = [];
    if (parent) {
      const ancestor = this.nodeReqs.get(parent);
      if (!ancestor) {
        throw new Error('missing parent');
      }
      ancestor.deps++;
      parentReqs.push(ancestor);
    }

    const req: SyncRequest = {
      path,
      hash,
      code: false,
      parent: parentReqs,
      deps: 0,
      callback
    };
    this.schedule(req);
  }

  async addCodeEntry(hash: Buffer, path: Nibbles, parent?: Buffer) {
    if (hash.equals(KECCAK256_NULL)) {
      return;
    }

    if (this.memBatch.hasCode(hash)) {
      return;
    }

    if (await this.backend.hasCode(hash)) {
      return;
    }

    const parentReqs: SyncRequest[] = [];
    if (parent) {
      const ancestor = this.nodeReqs.get(parent);
      if (!ancestor) {
        throw new Error('missing parent');
      }
      ancestor.deps++;
      parentReqs.push(ancestor);
    }

    const req: SyncRequest = {
      path,
      hash,
      code: true,
      parent: parentReqs,
      deps: 0
    };
    this.schedule(req);
  }

  missing(max: number) {
    const nodeHashes: Buffer[] = [];
    const nodePaths: TransportNibbles[][] = [];
    const codeHashes: Buffer[] = [];

    while (this.queue.length > 0 && (max === 0 || nodeHashes.length + codeHashes.length < max)) {
      const req: SyncRequest = this.queue.peek();

      if (req.code) {
        codeHashes.push(req.hash);
      } else {
        nodeHashes.push(req.hash);
        nodePaths.push(toTransportNibbles(req.path!));
      }

      this.queue.remove();
    }

    return {
      nodeHashes,
      nodePaths,
      codeHashes
    };
  }

  async process(hash: Buffer, data: Buffer) {
    const req = this.nodeReqs.get(hash) ?? this.codeReqs.get(hash);
    if (!req) {
      throw new Error('not found req');
    }

    if (req.code) {
      req.data = data;
      this._commit(req);
    } else {
      const node = decodeNode(data);
      req.data = data;

      const childReqs = await this.children(req, node);
      if (childReqs.length === 0 && req.deps === 0) {
        this._commit(req);
      } else {
        req.deps += childReqs.length;
        for (const childReq of childReqs) {
          this.schedule(childReq);
        }
      }
    }
  }

  commit(batch: RawDBatch) {
    for (const [hash, data] of this.memBatch.nodes) {
      batch.push({ type: 'put', key: hash, keyEncoding: 'none', value: data, valueEncoding: 'none' });
    }
    for (const [hash, data] of this.memBatch.codes) {
      batch.push({ type: 'put', key: hash, keyEncoding: 'none', value: data, valueEncoding: 'none' });
    }
    this.memBatch.clear();
  }

  private schedule(req: SyncRequest) {
    const map = req.code ? this.codeReqs : this.nodeReqs;
    const old = map.get(req.hash);
    if (old) {
      old.parent = old.parent.concat(req.parent);
      return;
    }

    map.set(req.hash, req);
    this.queue.push(req);
  }

  private async children(req: SyncRequest, node: TrieNode): Promise<SyncRequest[]> {
    const onChild = async (nibbles: Nibbles, value: Buffer | Buffer[]): Promise<SyncRequest[]> => {
      if (isRawNode(value)) {
        const child = decodeRawNode(value as Buffer[]);
        return await this.children(req, child);
      } else {
        const hash = value as Buffer;
        if (this.memBatch.hasNode(hash)) {
          return [];
        }

        if (await this.backend.hasTrieNode(hash)) {
          return [];
        }

        return [
          {
            path: [...req.path!, ...nibbles],
            hash,
            parent: [req],
            callback: req.callback,
            code: false,
            deps: 0
          }
        ];
      }
    };

    let reqs: SyncRequest[] = [];
    if (node instanceof LeafNode) {
      if (req.callback) {
        let paths!: Buffer[];
        const childPath = [...req.path!, ...node._nibbles];
        if (childPath.length === 2 * 32) {
          paths = [nibblesToBuffer(childPath)];
        } else if (childPath.length === 4 * 32) {
          paths = [nibblesToBuffer(childPath.slice(0, 64)), nibblesToBuffer(childPath.slice(64))];
        }
        await req.callback(paths, childPath, node._value, req.hash);
      }
    } else if (node instanceof ExtensionNode) {
      reqs = reqs.concat(await onChild(node._nibbles, node._value));
    } else if (node instanceof BranchNode) {
      for (let i = 0; i < 17; i++) {
        const child = node.getBranch(i);
        if (child) {
          reqs = reqs.concat(await onChild([i], child));
        }
      }
    }

    return reqs;
  }

  private _commit(req: SyncRequest) {
    if (req.code) {
      this.memBatch.putCode(req.hash, req.data!);
      this.codeReqs.delete(req.hash);
    } else {
      this.memBatch.putNode(req.hash, req.data!);
      this.nodeReqs.delete(req.hash);
    }

    for (const parent of req.parent) {
      parent.deps--;
      if (parent.deps === 0) {
        this._commit(parent);
      }
    }
  }
}
