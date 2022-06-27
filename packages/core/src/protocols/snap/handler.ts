import { BaseTrie as Trie } from 'merkle-patricia-tree';
import { logger } from '@rei-network/utils';
import { ProtocolHandler, Peer } from '@rei-network/network';
import { SnapProtocol } from './protocol';
import * as s from '../../consensus/reimint/snapMessages';
import { NetworkProtocol } from '../types';
import { EMPTY_HASH, MAX_HASH } from '../../utils';
import { StakingAccount } from '../../stateManager';
import { KECCAK256_NULL } from 'ethereumjs-util';

const softResponseLimit = 2 * 1024 * 1024;
const maxCodeLookups = 1024;
const stateLookupSlack = 0.1;
const requestTimeout = 8 * 1000;
const reqIDLimit = Number.MAX_SAFE_INTEGER;

export class SnapProtocolHandler implements ProtocolHandler {
  protected reqID = 0;
  readonly peer: Peer;
  readonly protocol: SnapProtocol;

  protected readonly waitingRequests = new Map<
    number,
    {
      resolve: (data: any) => void;
      reject: (reason?: any) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(protocol: SnapProtocol, peer: Peer) {
    this.protocol = protocol;
    this.peer = peer;
  }

  get node() {
    return this.protocol.node;
  }

  private generateReqID() {
    if (this.reqID > reqIDLimit) {
      this.reqID = 0;
    }
    return this.reqID++;
  }
  /**
   * Send request message to peer and wait for response
   * @param msg - Request message
   */
  request(msg: s.SnapMessage) {
    if (this.waitingRequests.has(msg.reqID)) {
      throw new Error('Request already in progress');
    }
    return new Promise<any>((resolve, reject) => {
      this.waitingRequests.set(msg.reqID, {
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.waitingRequests.delete(msg.reqID);
          reject(new Error(`timeout request ${msg.reqID}`));
        }, requestTimeout)
      });
      this.send(msg);
    });
  }

  /**
   *{@link ProtocolHandler.abort}
   */
  abort(): void {
    for (const [, request] of this.waitingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('abort'));
    }
    this.waitingRequests.clear();
    this.protocol.pool.remove(this);
  }

  /**
   * {@link ProtocolHandler.handle}
   * @param data - Buffer
   */
  async handle(data: Buffer) {
    const msg = s.SnapMessageFactory.fromSerializedMessage(data);
    const reqID = msg.reqID;
    const request = this.waitingRequests.get(reqID);
    if (request && (msg instanceof s.AccountRange || msg instanceof s.StorageRange || msg instanceof s.ByteCode || msg instanceof s.TrieNode)) {
      clearTimeout(request.timeout);
      this.waitingRequests.delete(reqID);
      request.resolve(data);
    } else {
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
  }

  private async applyGetAccountRange(msg: s.GetAccountRange) {
    const limit = msg.limitHash;
    const responseLimit = msg.responseLimit > softResponseLimit ? softResponseLimit : msg.responseLimit;
    const accountData: Buffer[][] = [];
    const proofs: Buffer[][] = [];
    let size = 0;
    let last: Buffer | undefined = undefined;
    const fastIter = this.node.snaptree.accountIterator(msg.rootHash, msg.startHash);
    await fastIter.init();

    for await (const { hash, value } of fastIter) {
      last = hash;
      const slimSerializedValue = value.slimSerialize();
      size += hash.length + slimSerializedValue.length;
      accountData.push([hash, slimSerializedValue]);

      if (hash.compare(limit) >= 0) {
        break;
      }
      if (size > responseLimit) {
        break;
      }
    }
    await fastIter.abort();
    const accTrie = new Trie(this.node.db.rawdb, msg.rootHash);
    proofs.push(await Trie.createProof(accTrie, msg.startHash));
    if (last) {
      proofs.push(await Trie.createProof(accTrie, last));
    }
    this.send(new s.AccountRange(msg.reqID, accountData, proofs));
  }

  private async applyGetStorageRange(msg: s.GetStorageRange) {
    const responseLimit = msg.responseLimit > softResponseLimit ? softResponseLimit : msg.responseLimit;
    const hardLimit = responseLimit * (1 + stateLookupSlack);
    let startHash: Buffer | undefined = msg.startHash;
    let limitHash: Buffer | undefined = msg.limitHash;
    let size = 0;

    const slots: Buffer[][][] = [];
    const proofs: Buffer[][] = [];
    for (let i = 0; i < msg.accountHashes.length; i++) {
      if (size > responseLimit) {
        break;
      }

      let origin = EMPTY_HASH;
      if (startHash) {
        origin = startHash;
        startHash = undefined;
      }
      let limit = MAX_HASH;
      if (limitHash) {
        limit = limitHash;
        limitHash = undefined;
      }

      const storage: Buffer[][] = [];
      let last: Buffer | undefined = undefined;
      let abort = false;
      const fastIter = this.node.snaptree.storageIterator(msg.rootHash, msg.accountHashes[i], origin);
      await fastIter.init();
      for await (const { hash, value } of fastIter) {
        if (size > hardLimit) {
          abort = true;
          break;
        }
        last = hash;
        storage.push([hash, value]);
        size += hash.length + value.length;
        if (hash.compare(limit) >= 0) {
          break;
        }
      }
      await fastIter.abort();
      if (storage.length > 0) {
        slots.push(storage);
      }

      if (!origin.equals(MAX_HASH) || (abort && slots.length > 0)) {
        const accTrie = new Trie(this.node.db.rawdb, msg.rootHash);
        const account = await accTrie.get(msg.accountHashes[i], true);
        const stTrie = new Trie(this.node.db.rawdb, StakingAccount.fromRlpSerializedAccount(account as Buffer).stateRoot);
        proofs.push(await Trie.createProof(stTrie, origin));
        if (last) {
          proofs.push(await Trie.createProof(stTrie, last));
        }
      }
    }
    this.send(new s.StorageRange(msg.reqID, slots, proofs));
  }

  private async applyGetByteCode(msg: s.GetByteCode) {
    const hashes = msg.hashes;
    const codesHash: Buffer[] = [];
    let responseLimit = msg.responseLimit;
    if (responseLimit > softResponseLimit) {
      responseLimit = softResponseLimit;
    }
    if (hashes.length > maxCodeLookups) {
      hashes.splice(maxCodeLookups);
    }
    let size = 0;
    const trie = new Trie(this.node.db.rawdb);
    for (let i = 0; i < hashes.length; i++) {
      if (hashes[i].equals(KECCAK256_NULL)) {
        codesHash.push(Buffer.alloc(0));
      } else {
        const codeResult = await trie.get(hashes[i]);
        if (codeResult) {
          codesHash.push(codeResult);
          size += codeResult.length;
        }
      }
      if (size > responseLimit) {
        break;
      }
    }
    this.send(new s.ByteCode(msg.reqID, codesHash));
  }

  private async applyGetTrieNode(msg: s.GetTrieNode) {
    const rootHash = msg.rootHash;
    const paths = msg.paths;
    let responseLimit = msg.responseLimit;
    if (responseLimit > softResponseLimit) {
      responseLimit = softResponseLimit;
    }

    const accTrie = new Trie(this.node.db.rawdb, rootHash);
    const snap = this.node.snaptree.snapShot(rootHash);
    if (!snap) {
      this.send(new s.TrieNode(msg.reqID, []));
      return;
    }

    const nodes: Buffer[] = [];
    let size = 0;
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      if (path.length === 0) {
        throw new Error('Invalid path');
      } else if (path.length === 1) {
        const node = await accTrie.get(path[0]);
        if (node) {
          nodes.push(node as Buffer);
          size += node.length;
        }
      } else {
        const account = await snap.getAccount(path[0]);
        if (!account) {
          break;
        }
        const slotTree = new Trie(this.node.db.rawdb, account.stateRoot);
        for (const p of path.slice(1)) {
          const node = await slotTree.get(p);
          if (node) {
            nodes.push(node);
            size += node.length;
          }
        }
      }
      if (size > responseLimit) {
        break;
      }
    }
    this.send(new s.TrieNode(msg.reqID, nodes));
  }
  /**
   * {@link ProtocolHandler.handshake}
   */
  handshake(): boolean | Promise<boolean> {
    return true;
  }

  /**
   * Requests an unknown number of accounts from a given account trie
   * @param rootHash The root hash of the account trie
   * @param startHash The start hash
   * @param limitHash The limit hash
   * @param responseLimit  The maximum number of bytes to send in a single response
   * @returns
   */
  getAccountRange(rootHash: Buffer, startHash: Buffer, limitHash: Buffer, responseLimit: number) {
    const msg = new s.GetAccountRange(this.generateReqID(), rootHash, startHash, limitHash, responseLimit);
    return this.request(msg);
  }

  /**
   * Requests the storage slots of multiple accounts' storage tries.
   * @param rootHash The root hash
   * @param accountHashes The hashes of the accounts
   * @param startHash The start hash
   * @param limitHash The limit hash
   * @param responseLimit The maximum number of bytes to send in a single response
   * @returns
   */
  getStorageRange(rootHash: Buffer, accountHashes: Buffer[], startHash: Buffer, limitHash: Buffer, responseLimit: number) {
    const msg = new s.GetStorageRange(this.generateReqID(), rootHash, accountHashes, startHash, limitHash, responseLimit);
    return this.request(msg);
  }

  /**
   * Requests a number of contract byte-codes by hash.
   * @param hashes  The hashes of the contracts
   * @param responseLimit The maximum number of bytes to send in a single response
   * @returns
   */
  getByteCode(hashes: Buffer[], responseLimit: number) {
    const msg = new s.GetByteCode(this.generateReqID(), hashes, responseLimit);
    return this.request(msg);
  }

  /**
   * Requests a number of state (either account or storage) Merkle trie nodes by path
   * @param rootHash The root hash of the trie
   * @param paths The paths of the nodes
   * @param responseLimit  The maximum number of bytes to send in a single response
   * @returns
   */
  getTrieNode(rootHash: Buffer, paths: Buffer[][], responseLimit: number) {
    const msg = new s.GetTrieNode(this.generateReqID(), rootHash, paths, responseLimit);
    return this.request(msg);
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
