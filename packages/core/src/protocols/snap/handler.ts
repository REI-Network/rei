import { BaseTrie as Trie } from 'merkle-patricia-tree';
import { keccak256, KECCAK256_NULL } from 'ethereumjs-util';
import { logger } from '@rei-network/utils';
import { ProtocolHandler, Peer } from '@rei-network/network';
import { SnapProtocol } from './protocol';
import * as s from '../../consensus/reimint/snapMessages';
import { NetworkProtocol } from '../types';
import { EMPTY_HASH, MAX_HASH } from '../../utils';
import { StakingAccount } from '../../stateManager';
import { mergeProof } from '../../snap/utils';
import { AccountRequest, AccountResponse, StorageRequst, StorageResponse } from '../../sync/snap/types';

const softResponseLimit = 2 * 1024 * 1024;
const maxCodeLookups = 1024;
const maxTrieNodeLookups = 1024;
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
      throw new Error('SnapProtocolHander::request, Request already in progress');
    }
    return new Promise<any>((resolve, reject) => {
      this.waitingRequests.set(msg.reqID, {
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.waitingRequests.delete(msg.reqID);
          reject(new Error(`SnapProtocolHander::request, timeout request ${msg.reqID}`));
        }, requestTimeout)
      });
      this.send(msg);
    });
  }

  /**
   * Remove this protocol handler from the pool and clean the request map
   * {@link ProtocolHandler.abort}
   */
  abort(): void {
    for (const [, request] of this.waitingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('SnapProtocolHander::abort, aborted'));
    }
    this.waitingRequests.clear();
    this.protocol.pool.remove(this);
  }

  /**
   * {@link ProtocolHandler.handle}
   */
  async handle(data: Buffer) {
    const msg = s.SnapMessageFactory.fromSerializedMessage(data);
    const reqID = msg.reqID;
    const request = this.waitingRequests.get(reqID);
    if (request && (msg instanceof s.AccountRange || msg instanceof s.StorageRange || msg instanceof s.ByteCode || msg instanceof s.TrieNode)) {
      clearTimeout(request.timeout);
      this.waitingRequests.delete(reqID);
      request.resolve(msg);
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

  /**
   * Apply GetAccountRange Message from the remote peer, get the account range
   * from snapshot and send the response to the remote peer
   * @param msg - GetAccountRange Message
   */
  private async applyGetAccountRange(msg: s.GetAccountRange) {
    const responseLimit = msg.responseLimit > softResponseLimit ? softResponseLimit : msg.responseLimit;
    const accountData: Buffer[][] = [];
    let proof: Buffer[] = [];
    let size = 0;
    let last: Buffer | undefined = undefined;

    try {
      const fastIter = this.node.snaptree.accountIterator(msg.rootHash, msg.startHash);
      await fastIter.init();
      for await (const { hash, value } of fastIter) {
        last = hash;
        const slimSerializedValue = value.slimSerialize();
        size += hash.length + slimSerializedValue.length;
        accountData.push([hash, slimSerializedValue]);

        if (hash.compare(msg.limitHash) >= 0) {
          break;
        }
        if (size > responseLimit) {
          break;
        }
      }
      await fastIter.abort();
      const accTrie = new Trie(this.node.db.rawdb, msg.rootHash);
      proof = await Trie.createProof(accTrie, msg.startHash);
      if (last) {
        proof = mergeProof(proof, await Trie.createProof(accTrie, last));
      }
      this.send(new s.AccountRange(msg.reqID, accountData, proof));
    } catch (err) {
      logger.error('SnapProtocolHander::applyGetAccountRange', err);
    }
  }

  /**
   * Apply GetStorageRange Message from the remote peer, get the storage range
   * from snapshot and send the response to the remote peer
   * @param msg - GetStorageRange Message
   */
  private async applyGetStorageRange(msg: s.GetStorageRange) {
    const responseLimit = msg.responseLimit > softResponseLimit ? softResponseLimit : msg.responseLimit;
    const hardLimit = responseLimit * (1 + stateLookupSlack);
    let startHash: Buffer | undefined = msg.startHash;
    let limitHash: Buffer | undefined = msg.limitHash;
    let size = 0;

    const slots: Buffer[][][] = [];
    let proof: Buffer[] = [];
    try {
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

        if (!origin.equals(EMPTY_HASH) || (abort && storage.length > 0)) {
          const accTrie = new Trie(this.node.db.rawdb, msg.rootHash);
          const account = await accTrie.get(msg.accountHashes[i]);
          if (!account) {
            return;
          }
          const stTrie = new Trie(this.node.db.rawdb, StakingAccount.fromRlpSerializedAccount(account).stateRoot);
          proof = await Trie.createProof(stTrie, origin);
          if (last) {
            proof = await Trie.createProof(stTrie, last);
          }
          break;
        }
      }
      this.send(new s.StorageRange(msg.reqID, slots, proof));
    } catch (err) {
      logger.error('SnapProtocolHander::applyGetStorageRange', err);
    }
  }

  /**
   * Apply GetByteCode Message from the remote peer, get the byte code
   * from database and send the response to the remote peer
   * @param msg - GetByteCode Message
   */
  private async applyGetByteCode(msg: s.GetByteCode) {
    const codes: Buffer[] = [];
    const responseLimit = msg.responseLimit > softResponseLimit ? softResponseLimit : msg.responseLimit;
    const hashes = msg.hashes.length > maxCodeLookups ? msg.hashes.splice(maxCodeLookups) : msg.hashes;
    let size = 0;
    for (let i = 0; i < hashes.length; i++) {
      if (hashes[i].equals(KECCAK256_NULL)) {
        codes.push(Buffer.alloc(0));
      } else {
        try {
          const codeResult = await this.node.db.rawdb.get(hashes[i], { keyEncoding: 'binary', valueEncoding: 'binary' });
          codes.push(codeResult);
          size += codeResult.length;
        } catch (err) {
          logger.error('SnapProtocolHander::applyGetByteCode', err);
        }
      }
      if (size > responseLimit) {
        break;
      }
    }
    this.send(new s.ByteCode(msg.reqID, codes));
  }

  /**
   * Apply GetTrieNode Message from the remote peer, get the trie node
   * from database and send the response to the remote peer
   * @param msg - GetTrieNode Message
   */
  private async applyGetTrieNode(msg: s.GetTrieNode) {
    const hashes = msg.hashes.length > maxTrieNodeLookups ? msg.hashes.splice(maxTrieNodeLookups) : msg.hashes;
    const responseLimit = msg.responseLimit > softResponseLimit ? softResponseLimit : msg.responseLimit;

    const nodes: Buffer[] = [];
    let size = 0;
    for (let i = 0; i < hashes.length; i++) {
      try {
        const node = await this.node.db.rawdb.get(hashes[i], { keyEncoding: 'binary', valueEncoding: 'binary' });
        nodes.push(node);
        size += node.length;
      } catch (err) {
        logger.error('SnapProtocolHander::applyGetTrieNode', err);
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
    this.protocol.pool.add(this);
    return true;
  }

  /**
   * Requests an unknown number of accounts from a given account trie
   * @param root  The root of the account trie
   * @param req  The request
   * @returns
   */
  async getAccountRange(root: Buffer, req: AccountRequest): Promise<AccountResponse | null> {
    const msg = new s.GetAccountRange(this.generateReqID(), root, req.origin, req.limit, softResponseLimit);
    try {
      const response = await this.request(msg);
      if (!(response instanceof s.AccountRange)) {
        logger.error('SnapProtocolHander::getAccountRange, received wrong message type');
        return null;
      }
      const hashes = response.accountData.map(([hash]) => hash);
      const accountValues = response.accountData.map(([, value]) => value);
      const accounts = accountValues.map((value) => StakingAccount.fromRlpSerializedAccount(value));
      const end = hashes.length > 0 ? hashes[hashes.length - 1] : null;
      const cont = await Trie.verifyRangeProof(root, req.origin, end, hashes, accountValues, response.proof);
      return { hashes, accounts, cont };
    } catch (err) {
      logger.error('SnapProtocolHander::getAccountRange', err);
      return null;
    }
  }

  /**
   * Requests the storage slots of multiple accounts' storage tries.
   * @param root  The root of the account trie
   * @param req The request
   * @returns
   */
  async getStorageRange(root: Buffer, req: StorageRequst): Promise<StorageResponse | null> {
    const msg = new s.GetStorageRange(this.generateReqID(), root, req.accounts, req.origin, req.limit, softResponseLimit);

    try {
      const response = await this.request(msg);
      if (!(response instanceof s.StorageRange)) {
        logger.error('SnapProtocolHander::getStorageRange, received wrong message type');
        return null;
      }
      const hashes = response.slots.map((slot) => slot.map(([hash]) => hash));
      const slots = response.slots.map((slot) => slot.map(([, value]) => value));
      if (hashes.length !== slots.length) {
        logger.error('SnapProtocolHander::getStorageRange, Hash and slot set size mismatch');
        return null;
      }
      if (hashes.length > req.accounts.length) {
        logger.error('SnapProtocolHander::getStorageRange, Hash set larger than requested');
        return null;
      }
      let cont = false;
      for (let i = 0; i < hashes.length; i++) {
        const keys = hashes[i];
        if (i === hashes.length - 1 && response.proof.length > 0) {
          const end = keys.length > 0 ? keys[keys.length - 1] : null;
          cont = await Trie.verifyRangeProof(req.roots[i], req.origin, end, keys, slots[i], response.proof);
        } else {
          await Trie.verifyRangeProof(req.roots[i], null, null, keys, slots[i], null);
        }
      }
      return { hashes, slots, cont };
    } catch (err) {
      logger.error('SnapProtocolHander::getStorageRange', err);
      return null;
    }
  }

  /**
   * Requests a number of contract byte-codes by hash.
   * @param hashes  The hashes of the contracts
   * @returns
   */
  async getByteCode(hashes: Buffer[]): Promise<Buffer[] | null> {
    const msg = new s.GetByteCode(this.generateReqID(), hashes, softResponseLimit);
    try {
      const response = await this.request(msg);
      if (!(response instanceof s.ByteCode)) {
        logger.error('SnapProtocolHander::getByteCode, received wrong message type');
        return null;
      }
      let codes: Buffer[] = new Array<Buffer>(hashes.length);
      let j = 0;
      for (let i = 0; i < response.codes.length; i++) {
        for (j; j < hashes.length && !keccak256(response.codes[i]).equals(hashes[j]); ) {
          j++;
        }
        if (j < hashes.length) {
          codes[j] = response.codes[i];
          j++;
          continue;
        }
        logger.error('SnapProtocolHander::getByteCode, Unexpected bytecodes, count:', response.codes.length - i);
        return null;
      }
      return codes;
    } catch (err) {
      logger.error('SnapProtocolHander::getByteCode', err);
      return null;
    }
  }

  /**
   * Requests a number of state (either account or storage) Merkle trie nodes by hash
   * @param hashes  The hashes of the state trie nodes
   * @returns
   */
  async getTrieNode(hashes: Buffer[]): Promise<Buffer[] | null> {
    const msg = new s.GetTrieNode(this.generateReqID(), hashes, softResponseLimit);
    try {
      const response = await this.request(msg);
      if (!(response instanceof s.TrieNode)) {
        logger.error('SnapProtocolHander::getTrieNode, received wrong message type');
        return null;
      }
      let nodes: Buffer[] = new Array<Buffer>(hashes.length);
      let j = 0;
      for (let i = 0; i < response.nodes.length; i++) {
        for (j; j < hashes.length && !keccak256(response.nodes[i]).equals(hashes[j]); ) {
          j++;
        }
        if (j < hashes.length) {
          nodes[j] = response.nodes[i];
          j++;
          continue;
        }
        logger.error('SnapProtocolHander::getTrieNode, Unexpected nodes, count:', response.nodes.length - i);
        return null;
      }
      return nodes;
    } catch (err) {
      logger.error('SnapProtocolHander::getTrieNode', err);
      return null;
    }
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
