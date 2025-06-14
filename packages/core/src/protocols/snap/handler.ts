import { BaseTrie as Trie } from '@rei-network/trie';
import { keccak256, KECCAK256_NULL } from 'ethereumjs-util';
import { logger } from '@rei-network/utils';
import { ProtocolHandler, Peer, ProtocolStream } from '@rei-network/network';
import { EMPTY_HASH, MAX_HASH } from '../../utils';
import { StakingAccount } from '../../stateManager';
import { mergeProof } from '../../snap/utils';
import {
  AccountRequest,
  AccountResponse,
  StorageRequst,
  StorageResponse
} from '../../sync/snap/types';
import { SnapProtocol } from './protocol';
import * as m from './messages';

const defaultSoftResponseLimit = 512 * 1024;
const maxCodeLookups = 1024;
const maxTrieNodeLookups = 1024;
const stateLookupSlack = 0.1;
const requestTimeout = 8 * 1000;

/**
 * SnapProtocolHandler is used to manage snap protocol communication between nodes
 */
export class SnapProtocolHandler implements ProtocolHandler {
  private reqID = 0;
  private softResponseLimit: number;
  readonly peer: Peer;
  readonly stream: ProtocolStream;
  readonly protocol: SnapProtocol;

  protected readonly waitingRequests = new Map<
    number,
    {
      resolve: (data: any) => void;
      reject: (reason?: any) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(
    protocol: SnapProtocol,
    peer: Peer,
    stream: ProtocolStream,
    softResponseLimit?: number
  ) {
    this.softResponseLimit = softResponseLimit ?? defaultSoftResponseLimit;
    this.protocol = protocol;
    this.stream = stream;
    this.peer = peer;
  }

  /**
   * Get protocol's node
   */
  get node() {
    return this.protocol.node;
  }

  /**
   * Get peer id
   */
  get id() {
    return this.peer.peerId;
  }

  /**
   * Get handler pool
   */
  get pool() {
    return this.protocol.pool;
  }

  /**
   * Reset the soft response limit of handler
   * @param limit - Limit of the response
   */
  resetSoftResponseLimit(limit: number) {
    this.softResponseLimit = limit;
  }

  private generateReqID() {
    if (this.reqID >= Number.MAX_SAFE_INTEGER) {
      this.reqID = 0;
    }
    return this.reqID++;
  }

  /**
   * Send request message to peer and wait for response
   * @param msg - Request message
   */
  request(msg: m.SnapMessage) {
    if (this.waitingRequests.has(msg.reqID)) {
      throw new Error('request already in progress');
    }
    return new Promise<any>((resolve, reject) => {
      this.waitingRequests.set(msg.reqID, {
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.waitingRequests.delete(msg.reqID);
          reject(new Error('timeout request'));
        }, requestTimeout)
      });
      this.send(msg);
    });
  }

  /**
   * {@link ProtocolHandler.abort}
   */
  abort(): void {
    for (const [, request] of this.waitingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('aborted'));
    }
    this.waitingRequests.clear();
    this.pool.remove(this);
  }

  /**
   * {@link ProtocolHandler.handle}
   */
  async handle(data: Buffer) {
    try {
      const msg = m.SnapMessageFactory.fromSerializedMessage(data);
      const reqID = msg.reqID;
      const request = this.waitingRequests.get(reqID);
      if (
        request &&
        (msg instanceof m.AccountRange ||
          msg instanceof m.StorageRange ||
          msg instanceof m.ByteCode ||
          msg instanceof m.TrieNode)
      ) {
        clearTimeout(request.timeout);
        this.waitingRequests.delete(reqID);
        request.resolve(msg);
      } else {
        if (msg instanceof m.GetAccountRange) {
          await this.applyGetAccountRange(msg);
        } else if (msg instanceof m.GetStorageRange) {
          await this.applyGetStorageRange(msg);
        } else if (msg instanceof m.GetByteCode) {
          await this.applyGetByteCode(msg);
        } else if (msg instanceof m.GetTrieNode) {
          await this.applyGetTrieNode(msg);
        } else {
          logger.warn('SnapProtocolHandler::handle, unknown message');
        }
      }
    } catch (err) {
      logger.error('SnapProtocolHandler::handle, catch error:', err);
    }
  }

  /**
   * Apply GetAccountRange Message from the remote peer, get the account range
   * from snapshot and send the response to the remote peer
   * @param msg - GetAccountRange Message
   */
  private async applyGetAccountRange(msg: m.GetAccountRange) {
    const responseLimit =
      msg.responseLimit > this.softResponseLimit
        ? this.softResponseLimit
        : msg.responseLimit;
    const accountData: Buffer[][] = [];
    let proof: Buffer[] = [];
    let size = 0;
    let last: Buffer | undefined = undefined;

    try {
      for await (const {
        hash,
        value
      } of await this.node.snapTree!.accountIterator(
        msg.rootHash,
        msg.startHash
      )) {
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
      const accTrie = new Trie(this.node.db.rawdb, msg.rootHash);
      proof = await Trie.createProof(accTrie, msg.startHash);
      if (last) {
        proof = mergeProof(proof, await Trie.createProof(accTrie, last));
      }
      this.send(new m.AccountRange(msg.reqID, accountData, proof));
    } catch (err) {
      logger.debug('SnapProtocolHandler::applyGetAccountRange', err);
      this.send(new m.AccountRange(msg.reqID, [], []));
    }
  }

  /**
   * Apply GetStorageRange Message from the remote peer, get the storage range
   * from snapshot and send the response to the remote peer
   * @param msg - GetStorageRange Message
   */
  private async applyGetStorageRange(msg: m.GetStorageRange) {
    const responseLimit =
      msg.responseLimit > this.softResponseLimit
        ? this.softResponseLimit
        : msg.responseLimit;
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

        for await (const {
          hash,
          value
        } of await this.node.snapTree!.storageIterator(
          msg.rootHash,
          msg.accountHashes[i],
          origin
        )) {
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
        if (storage.length > 0) {
          slots.push(storage);
        }

        if (!origin.equals(EMPTY_HASH) || (abort && storage.length > 0)) {
          const accTrie = new Trie(this.node.db.rawdb, msg.rootHash);
          const account = await accTrie.get(msg.accountHashes[i]);
          if (!account) {
            return;
          }
          const stTrie = new Trie(
            this.node.db.rawdb,
            StakingAccount.fromRlpSerializedAccount(account).stateRoot
          );
          proof = await Trie.createProof(stTrie, origin);
          if (last) {
            proof = mergeProof(proof, await Trie.createProof(stTrie, last));
          }
          break;
        }
      }
      this.send(new m.StorageRange(msg.reqID, slots, proof));
    } catch (err) {
      logger.debug('SnapProtocolHandler::applyGetStorageRange', err);
      this.send(new m.StorageRange(msg.reqID, [], []));
    }
  }

  /**
   * Apply GetByteCode Message from the remote peer, get the byte code
   * from database and send the response to the remote peer
   * @param msg - GetByteCode Message
   */
  private async applyGetByteCode(msg: m.GetByteCode) {
    const codes: Buffer[] = [];
    const responseLimit =
      msg.responseLimit > this.softResponseLimit
        ? this.softResponseLimit
        : msg.responseLimit;
    const hashes =
      msg.hashes.length > maxCodeLookups
        ? msg.hashes.splice(maxCodeLookups)
        : msg.hashes;
    let size = 0;
    for (let i = 0; i < hashes.length; i++) {
      if (hashes[i].equals(KECCAK256_NULL)) {
        codes.push(Buffer.alloc(0));
      } else {
        try {
          const codeResult = await this.node.db.getCode(hashes[i]);
          codes.push(codeResult);
          size += codeResult.length;
        } catch (err) {
          // ignore errors...
        }
      }
      if (size > responseLimit) {
        break;
      }
    }
    this.send(new m.ByteCode(msg.reqID, codes));
  }

  /**
   * Apply GetTrieNode Message from the remote peer, get the trie node
   * from database and send the response to the remote peer
   * @param msg - GetTrieNode Message
   */
  private async applyGetTrieNode(msg: m.GetTrieNode) {
    const hashes =
      msg.hashes.length > maxTrieNodeLookups
        ? msg.hashes.splice(maxTrieNodeLookups)
        : msg.hashes;
    const responseLimit =
      msg.responseLimit > this.softResponseLimit
        ? this.softResponseLimit
        : msg.responseLimit;
    const nodes: Buffer[] = [];
    let size = 0;
    for (let i = 0; i < hashes.length; i++) {
      try {
        const node = await this.node.db.getTrieNode(hashes[i]);
        nodes.push(node);
        size += node.length;
      } catch (err) {
        // ignore errors...
      }
      if (size > responseLimit) {
        break;
      }
    }
    this.send(new m.TrieNode(msg.reqID, nodes));
  }

  /**
   * {@link ProtocolHandler.handshake}
   */
  handshake(): boolean | Promise<boolean> {
    this.pool.add(this);
    return true;
  }

  /**
   * Requests an unknown number of accounts from a given account trie
   * @param root - Root of the account trie
   * @param req - Request data
   * @returns AccountResponse data, if something went wrong, return null
   */
  async getAccountRange(
    root: Buffer,
    req: AccountRequest
  ): Promise<AccountResponse | null> {
    try {
      const msg = new m.GetAccountRange(
        this.generateReqID(),
        root,
        req.origin,
        req.limit,
        this.softResponseLimit
      );
      const response = await this.request(msg);
      if (!(response instanceof m.AccountRange)) {
        logger.warn(
          'SnapProtocolHandler::getAccountRange, received wrong message type'
        );
        return null;
      }
      const hashes = response.accountData.map(([hash]) => hash);
      if (hashes.length === 0 && response.proof.length === 0) {
        logger.debug(
          'SnapProtocolHandler::getAccountRange, stateless peer:',
          this.id
        );
        this.pool.putStatelessPeer(this);
        return null;
      }
      for (let i = 1; i < hashes.length; i++) {
        if (hashes[i - 1].compare(hashes[i]) >= 0) {
          logger.warn(
            'SnapProtocolHandler::getAccountRange, invalid hash order'
          );
          return null;
        }
      }
      const accountValues = response.accountData.map(([, value]) => value);
      const accounts = accountValues.map((value) =>
        StakingAccount.fromRlpSerializedSlimAccount(value)
      );
      const end = hashes.length > 0 ? hashes[hashes.length - 1] : null;
      const cont = await Trie.verifyRangeProof(
        root,
        req.origin,
        end,
        hashes,
        accounts.map((accout) => accout.serialize()),
        response.proof
      );
      return { hashes, accounts, cont };
    } catch (err) {
      logger.warn('SnapProtocolHandler::getAccountRange', err);
      return null;
    } finally {
      this.pool.putBackIdlePeer('account', this);
    }
  }

  /**
   * Requests the storage slots of multiple accounts' storage tries.
   * @param root - Root of the account trie
   * @param req - Request data
   * @returns StorageResponse data, if something went wrong, return null
   */
  async getStorageRanges(
    root: Buffer,
    req: StorageRequst
  ): Promise<StorageResponse | null> {
    try {
      const msg = new m.GetStorageRange(
        this.generateReqID(),
        root,
        req.accounts,
        req.origin,
        req.limit,
        this.softResponseLimit
      );
      const response = await this.request(msg);
      if (!(response instanceof m.StorageRange)) {
        logger.warn(
          'SnapProtocolHandler::getStorageRange, received wrong message type'
        );
        return null;
      }
      const hashes = response.slots.map((slot) => slot.map(([hash]) => hash));
      if (hashes.length === 0) {
        logger.debug(
          'SnapProtocolHandler::getStorageRanges, stateless peer:',
          this.id
        );
        this.pool.putStatelessPeer(this);
        return null;
      }
      for (const _hashes of hashes) {
        for (let i = 1; i < _hashes.length; i++) {
          if (_hashes[i - 1].compare(_hashes[i]) >= 0) {
            logger.warn(
              'SnapProtocolHandler::getStorageRange, invalid hash order'
            );
            return null;
          }
        }
      }
      const slots = response.slots.map((slot) =>
        slot.map(([, value]) => value)
      );
      if (hashes.length !== slots.length) {
        logger.warn(
          'SnapProtocolHandler::getStorageRange, hash and slot set size mismatch'
        );
        return null;
      }
      if (hashes.length > req.accounts.length) {
        logger.warn(
          'SnapProtocolHandler::getStorageRange, hash set larger than requested'
        );
        return null;
      }
      let cont = false;
      for (let i = 0; i < hashes.length; i++) {
        const keys = hashes[i];
        if (i === hashes.length - 1 && response.proof.length > 0) {
          const end = keys.length > 0 ? keys[keys.length - 1] : null;
          cont = await Trie.verifyRangeProof(
            req.roots[i],
            req.origin,
            end,
            keys,
            slots[i],
            response.proof
          );
        } else {
          await Trie.verifyRangeProof(
            req.roots[i],
            null,
            null,
            keys,
            slots[i],
            null
          );
        }
      }
      return { hashes, slots, cont };
    } catch (err) {
      logger.warn('SnapProtocolHandler::getStorageRange', err);
      return null;
    } finally {
      this.pool.putBackIdlePeer('storage', this);
    }
  }

  /**
   * Requests a number of contract bytecodes by hash.
   * @param hashes - Hashes of the bytecodes to request
   * @returns Codes, if something went wrong, return null
   */
  async getByteCodes(hashes: Buffer[]): Promise<(Buffer | undefined)[] | null> {
    try {
      const msg = new m.GetByteCode(
        this.generateReqID(),
        hashes,
        this.softResponseLimit
      );
      const response = await this.request(msg);
      if (!(response instanceof m.ByteCode)) {
        logger.warn(
          'SnapProtocolHandler::getByteCode, received wrong message type'
        );
        return null;
      }
      if (response.codes.length === 0) {
        logger.debug(
          'SnapProtocolHandler::getByteCodes, stateless peer:',
          this.id
        );
        this.pool.putStatelessPeer(this);
        return null;
      }
      let codes: Buffer[] = new Array<Buffer>(hashes.length);
      for (let i = 0, j = 0; i < response.codes.length; i++) {
        while (
          j < hashes.length &&
          !keccak256(response.codes[i]).equals(hashes[j])
        ) {
          j++;
        }
        if (j < hashes.length) {
          codes[j] = response.codes[i];
          j++;
          continue;
        }
        logger.warn(
          'SnapProtocolHandler::getByteCode, unexpected bytecodes, count:',
          response.codes.length - i
        );
        return null;
      }
      return codes;
    } catch (err) {
      logger.warn('SnapProtocolHandler::getByteCode', err);
      return null;
    } finally {
      this.pool.putBackIdlePeer('code', this);
    }
  }

  /**
   * Requests a number of state (either account or storage) Merkle trie nodes by hash
   * @param hashes - Hashes of the trie nodes to request
   * @returns TrieNodes, if something went wrong, return null
   */
  async getTrieNodes(hashes: Buffer[]): Promise<(Buffer | undefined)[] | null> {
    try {
      const msg = new m.GetTrieNode(
        this.generateReqID(),
        hashes,
        defaultSoftResponseLimit
      );
      const response = await this.request(msg);
      if (!(response instanceof m.TrieNode)) {
        logger.warn(
          'SnapProtocolHandler::getTrieNode, received wrong message type'
        );
        return null;
      }
      if (response.nodes.length === 0) {
        logger.debug(
          'SnapProtocolHandler::getTrieNodes, stateless peer:',
          this.id
        );
        this.pool.putStatelessPeer(this);
        return null;
      }
      let nodes: Buffer[] = new Array<Buffer>(hashes.length);
      for (let i = 0, j = 0; i < response.nodes.length; i++) {
        while (
          j < hashes.length &&
          !keccak256(response.nodes[i]).equals(hashes[j])
        ) {
          j++;
        }
        if (j < hashes.length) {
          nodes[j] = response.nodes[i];
          j++;
          continue;
        }
        logger.warn(
          'SnapProtocolHandler::getTrieNode,unexpected nodes, count:',
          response.nodes.length - i
        );
        return null;
      }
      return nodes;
    } catch (err) {
      logger.warn('SnapProtocolHandler::getTrieNode', err);
      return null;
    } finally {
      this.pool.putBackIdlePeer('trieNode', this);
    }
  }

  /**
   * Send message to the remote peer
   * @param msg - Message
   */
  send(msg: m.SnapMessage) {
    try {
      this.stream.send(m.SnapMessageFactory.serializeMessage(msg));
    } catch (err) {
      // ignore errors...
    }
  }

  getRemoteStatus() {
    return {
      name: 'xxx',
      version: 1
    };
  }
}
