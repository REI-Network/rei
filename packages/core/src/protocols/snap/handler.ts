import { BaseTrie as Trie } from 'merkle-patricia-tree';
import { logger } from '@rei-network/utils';
import { ProtocolHandler, Peer } from '@rei-network/network';
import { SnapProtocol } from './protocol';
import * as s from '../../consensus/reimint/snapMessages';
import { NetworkProtocol } from '../types';
import { EMPTY_HASH, MAX_HASH } from '../../utils';
import { StakingAccount } from '../../stateManager';
import { KVIterator } from '../../snap/trieIterator';

const softResponseLimit = 2 * 1024 * 1024;
const maxCodeLookups = 1024;
const maxTrieNodeLookups = 1024;

export class SnapProtocolHandler implements ProtocolHandler {
  readonly peer: Peer;
  readonly protocol: SnapProtocol;

  constructor(protocol: SnapProtocol, peer: Peer) {
    this.peer = peer;
    this.protocol = protocol;
  }

  get node() {
    return this.protocol.node;
  }

  /**
   *{@link ProtocolHandler.abort}
   */
  abort(): void {}

  /**
   * {@link ProtocolHandler.handle}
   * @param data - Buffer
   */
  async handle(data: Buffer) {
    const msg = s.SnapMessageFactory.fromSerializedMessage(data);

    if (msg instanceof s.GetAccountRange) {
      await this.applyGetAccountRange(msg);
    } else if (msg instanceof s.GetStorageRange) {
      await this.applyGetStorageRange(msg);
    } else if (msg instanceof s.GetByteCode) {
      await this.applyGetByteCode(msg);
    } else if (msg instanceof s.GetTrieNode) {
      await this.applyGetTrieNode(msg);
    } else {
      logger.warn('SnapProtocolHander::handle, unknown message');
    }
  }

  private async applyGetAccountRange(msg: s.GetAccountRange) {
    const root = msg.root;
    const start = msg.startHash;
    const limit = msg.limitHash;
    let responseBytes = msg.responseBytes;
    if (responseBytes > softResponseLimit) {
      responseBytes = softResponseLimit;
    }
    const accountData: Buffer[][] = [];
    const proofs: Buffer[][] = [];
    let size = 0;
    let last = EMPTY_HASH;
    let lastAccount;
    for await (const { hash, getValue } of this.node.snaptree.accountIterator(root, start)) {
      last = hash;
      lastAccount = getValue();

      if (hash.equals(start)) {
        proofs.push(await Trie.createProof(new Trie(this.node.db.rawdb, lastAccount?.stateRoot), start));
      }
      accountData.push([hash, lastAccount?.slimSerialize() ?? Buffer.alloc(0)]);
      size += (lastAccount as StakingAccount).serialize().length;
      if (hash.compare(limit) > 0) {
        break;
      }
      if (size > responseBytes) {
        break;
      }
    }
    if (!last.equals(EMPTY_HASH)) {
      proofs.push(await Trie.createProof(new Trie(this.node.db.rawdb, lastAccount?.stateRoot), last));
    }
    this.send(new s.AccountRange(accountData, proofs));
  }

  private async applyGetStorageRange(msg: s.GetStorageRange) {
    const root = msg.rootHash;
    const accountHashes = msg.accountHashes;
    const startHash = msg.startingHash;
    const limitHash = msg.limitHash;
    let responseBytes = msg.responseBytes;

    const empty = Buffer.concat([EMPTY_HASH, EMPTY_HASH]);
    const max = Buffer.concat([MAX_HASH, MAX_HASH]);
    const origin = startHash.length > 0 ? startHash : empty;
    const limit = limitHash.length > 0 ? limitHash : max;
    if (responseBytes > softResponseLimit) {
      responseBytes = softResponseLimit;
    }
    let size = 0;

    const storage: Buffer[][][] = [];
    const proofs: Buffer[][] = [];
    for (let i = 0; i < accountHashes.length; i++) {
      if (size > responseBytes) {
        break;
      }
      const slots: Buffer[][] = [];
      let last = EMPTY_HASH;
      let abort = false;
      const { iter, destructed } = this.node.snaptree.storageIterator(root, accountHashes[i], origin);
      for await (const { hash, getValue } of iter) {
        if (size > responseBytes) {
          abort = true;
          break;
        }
        last = hash;
        slots.push([hash, getValue()]);
        size += hash.length + getValue().length;
        if (hash.compare(limit) > 1) {
          break;
        }
      }
      storage.push(slots);

      if (!origin.equals(empty) || (abort && slots.length > 0)) {
        const accTrie = new Trie(this.node.db.rawdb, accountHashes[i]);
        const account = await accTrie.get(accountHashes[i], true);
        const stTrie = new Trie(this.node.db.rawdb, StakingAccount.fromRlpSerializedAccount(account as Buffer).stateRoot);
        proofs.push(await Trie.createProof(stTrie, origin));
        proofs.push(await Trie.createProof(stTrie, last));
      }
    }
    this.send(new s.StorageRange(storage, proofs));
  }

  private async applyGetByteCode(msg: s.GetByteCode) {
    const hashes = msg.hashes;
    const codesHash: Buffer[] = [];
    let responseBytes = msg.responseBytes;
    if (responseBytes > softResponseLimit) {
      responseBytes = softResponseLimit;
    }
    if (hashes.length > maxCodeLookups) {
      hashes.splice(maxCodeLookups);
    }
    let size = 0;
    const trie = new Trie(this.node.chaindb);
    for (let i = 0; i < hashes.length; i++) {
      if (hashes[i] === EMPTY_HASH) {
        codesHash.push(Buffer.alloc(0));
      } else {
        const codeResult = await trie.get(hashes[i]);
        const code = codeResult ? codeResult : Buffer.alloc(0);
        codesHash.push(code);
        size += code.length;
      }
      if (size > responseBytes) {
        break;
      }
    }
    this.send(new s.ByteCode(codesHash));
  }

  private async applyGetTrieNode(msg: s.GetTrieNode) {
    const rootHash = msg.rootHash;
    const paths = msg.paths;
    let responseBytes = msg.responseBytes;
    if (responseBytes > softResponseLimit) {
      responseBytes = softResponseLimit;
    }

    const accTrie = new Trie(this.node.db.rawdb, rootHash);
    const snap = this.node.snaptree.snapShot(rootHash);
    if (!snap) {
      this.send(new s.TrieNode([]));
    }

    const nodes: Buffer[] = [];
    let size = 0;
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      if (path.length === 0) {
        throw new Error('Invalid path');
      } else if (path.length === 1) {
        const node = await accTrie.get(path[0], true);
        const account = StakingAccount.fromRlpSerializedAccount(node!);
        const slotTree = new Trie(this.node.db.rawdb, account.stateRoot);
        for await (const { key, val } of new KVIterator(slotTree)) {
          nodes.push(val);
        }
      } else {
        const account = await snap?.getAccount(path[0]);
        if (!account) {
          break;
        }
        const slotTree = new Trie(this.node.db.rawdb, account.stateRoot);
        for (const p of path.slice(1)) {
          const node = await slotTree.get(p, true);
          nodes.push(node as Buffer);
          size += (node as Buffer).length;
        }
      }
      if (size > responseBytes) {
        break;
      }
    }
    this.send(new s.TrieNode(nodes));
  }
  /**
   * {@link ProtocolHandler.handshake}
   */
  handshake(): boolean | Promise<boolean> {
    return true;
  }

  /**
   * Send message to the remote peer
   * @param msg - Message
   */
  send(msg: s.SnapMessage) {
    if (this.peer.isSupport(NetworkProtocol.REI_SNAP)) {
      this.peer.send(this.protocol.name, s.SnapMessageFactory.serializeMessage(msg));
    }
  }
}
