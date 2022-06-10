import Heap from 'qheap';
import { KECCAK256_NULL, KECCAK256_RLP } from 'ethereumjs-util';
import { BranchNode, ExtensionNode, LeafNode, Nibbles, TrieNode, isRawNode, decodeRawNode, decodeNode } from 'merkle-patricia-tree/dist/trieNode';
import { nibblesToBuffer } from 'merkle-patricia-tree/dist/util/nibbles';
import { FunctionalBufferMap } from '@rei-network/utils';
import { StakingAccount } from '../../stateManager';
import { BinaryRawDBatch } from '../../utils';

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

function compareSyncRequest(a: SyncRequest, b: SyncRequest) {
  let res = (a.path?.length ?? 0) - (b.path?.length ?? 0);
  if (res === 0) {
    res = a.hash.compare(b.hash);
  }
  return res;
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

/**
 * TrieSync is a scheduler that synchronizes all missing trie nodes or code
 */
export class TrieSync {
  private readonly backend: TrieSyncBackend;
  private readonly memBatch = new SyncMemBatch();
  private readonly nodeReqs = new FunctionalBufferMap<SyncRequest>();
  private readonly codeReqs = new FunctionalBufferMap<SyncRequest>();
  private verifyMode = false;

  private queue = new Heap({ compar: compareSyncRequest });

  constructor(backend: TrieSyncBackend, verifyMode?: boolean) {
    this.backend = backend;
    verifyMode && (this.verifyMode = verifyMode);
  }

  get pending() {
    return this.nodeReqs.size + this.codeReqs.size;
  }

  /**
   * Set sync root
   * @param root - Root node hash
   * @param onLeaf - Leaf callback
   */
  setRoot(root: Buffer, onLeaf?: LeafCallback) {
    return this.addSubTrie(root, undefined, undefined, async (paths, path, leaf, parent) => {
      onLeaf && (await onLeaf(paths, path, leaf, parent));

      try {
        const account = StakingAccount.fromRlpSerializedAccount(leaf);
        await this.addSubTrie(account.stateRoot, path, parent, onLeaf);
        await this.addCodeEntry(account.codeHash, path, parent);
      } catch (err) {
        // ignore invalid leaf node
      }
    });
  }

  /**
   * Clear sync scheduler
   */
  clear() {
    this.memBatch.clear();
    this.nodeReqs.clear();
    this.codeReqs.clear();
    this.queue = new Heap({ compar: compareSyncRequest });
  }

  /**
   * Add a trie to the sync queue
   * @param hash - Root node hash
   * @param path - Node path
   * @param parent - Parent node
   * @param callback - Leaf callback
   */
  async addSubTrie(hash: Buffer, path?: Nibbles, parent?: Buffer, callback?: LeafCallback) {
    if (hash.equals(KECCAK256_RLP)) {
      return;
    }

    if (this.memBatch.hasNode(hash) && !this.verifyMode) {
      return;
    }

    if ((await this.backend.hasTrieNode(hash)) && !this.verifyMode) {
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

    this.schedule({
      path,
      hash,
      code: false,
      parent: parentReqs,
      deps: 0,
      callback
    });
  }

  /**
   * Add a code entry to the sync queue
   * @param hash - Code has
   * @param path - Path
   * @param parent - Parent node(it is a node)
   */
  async addCodeEntry(hash: Buffer, path: Nibbles, parent?: Buffer) {
    if (hash.equals(KECCAK256_NULL)) {
      return;
    }

    if (this.memBatch.hasCode(hash) && !this.verifyMode) {
      return;
    }

    if ((await this.backend.hasCode(hash)) && !this.verifyMode) {
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

    this.schedule({
      path,
      hash,
      code: true,
      parent: parentReqs,
      deps: 0
    });
  }

  /**
   * Retrieve known missing nodes or code
   * @param max - Maximum number of nodes or code
   * @returns Missing node or code
   */
  missing(max: number) {
    const nodeHashes: Buffer[] = [];
    const codeHashes: Buffer[] = [];

    while (this.queue.length > 0 && (max === 0 || nodeHashes.length + codeHashes.length < max)) {
      const req: SyncRequest = this.queue.peek();

      if (req.code) {
        codeHashes.push(req.hash);
      } else {
        nodeHashes.push(req.hash);
      }

      this.queue.remove();
    }

    return { nodeHashes, codeHashes };
  }

  /**
   * Process trie node response
   * @param hash
   * @param data
   */
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

  /**
   * Flush node and code to db
   * @param batch
   */
  commit(batch: BinaryRawDBatch) {
    for (const [hash, data] of this.memBatch.nodes) {
      batch.push({ type: 'put', key: hash, value: data });
    }
    for (const [hash, data] of this.memBatch.codes) {
      batch.push({ type: 'put', key: hash, value: data });
    }
    this.memBatch.clear();
  }

  /**
   * Put the request object to queue
   * @param req
   */
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

  /**
   * Retrieve all non-existing child nodes
   * @param req - Parent request
   * @param node - Parent node
   * @returns Requests
   */
  private async children(req: SyncRequest, node: TrieNode): Promise<SyncRequest[]> {
    const onChild = async (nibbles: Nibbles, value: Buffer | Buffer[]): Promise<SyncRequest[]> => {
      if (isRawNode(value)) {
        // the value is a raw node, decode it directly
        const child = decodeRawNode(value as Buffer[]);
        return await this.children(req, child);
      } else {
        // the value is the hash of child node, try to queue it
        const hash = value as Buffer;
        if (!this.verifyMode && this.memBatch.hasNode(hash)) {
          return [];
        }

        if (!this.verifyMode && (await this.backend.hasTrieNode(hash))) {
          return [];
        }

        return [
          {
            path: [...(req.path ?? []), ...nibbles],
            hash,
            parent: [req],
            callback: req.callback,
            code: false,
            deps: 0
          }
        ];
      }
    };

    const onLeaf = async (nibbles: Nibbles, value: Buffer) => {
      if (req.callback) {
        let paths!: Buffer[];
        const childPath = [...(req.path ?? []), ...nibbles];
        if (childPath.length === 2 * 32) {
          paths = [nibblesToBuffer(childPath)];
        } else if (childPath.length === 4 * 32) {
          paths = [nibblesToBuffer(childPath.slice(0, 64)), nibblesToBuffer(childPath.slice(64))];
        }
        await req.callback(paths, childPath, value, req.hash);
      }
    };

    let reqs: SyncRequest[] = [];
    if (node instanceof LeafNode) {
      // leaf nodes have no children,
      // call the callback, then do nothing
      await onLeaf(node._nibbles, node._value);
    } else if (node instanceof ExtensionNode) {
      // process the child node of extension node
      reqs = reqs.concat(await onChild(node._nibbles, node._value));
    } else if (node instanceof BranchNode) {
      // process all child nodes of branch node
      for (let i = 0; i < 16; i++) {
        const child = node.getBranch(i);
        if (child) {
          reqs = reqs.concat(await onChild([i], child));
        }
      }

      // branch node may also contain a value
      if (node._value && node._value.length > 0) {
        await onLeaf([], node._value);
      }
    }

    return reqs;
  }

  /**
   * Flush node to memory bath
   * @param req
   */
  private _commit(req: SyncRequest) {
    if (req.code) {
      !this.verifyMode && this.memBatch.putCode(req.hash, req.data!);
      this.codeReqs.delete(req.hash);
    } else {
      !this.verifyMode && this.memBatch.putNode(req.hash, req.data!);
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
