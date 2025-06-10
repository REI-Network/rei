import {
  bufferToInt,
  rlp,
  BN,
  intToBuffer,
  bufferToHex
} from 'ethereumjs-util';
import { Transaction, Block, BlockHeader } from '@rei-network/structure';
import { logger, Channel, FunctionalBufferSet } from '@rei-network/utils';
import { ProtocolHandler, Peer, ProtocolStream } from '@rei-network/network';
import { Node } from '../../node';
import { NodeStatus } from '../../types';
import { HandlerPool } from './handlerPool';
import { HandlerFunc } from './wireFunctions';
import * as c from './config';

export interface WireProtocol {
  readonly node: Node;
  readonly pool: HandlerPool<WireProtocolHandler>;
  get protocolString(): string;
  get version(): string;
  get name(): string;
}

/**
 * WireProtocolHandler is used to manage protocol communication between nodes
 */
export abstract class WireProtocolHandler implements ProtocolHandler {
  readonly peer: Peer;
  readonly stream: ProtocolStream;
  readonly protocol: WireProtocol;

  private _status?: NodeStatus;
  private _knowTxs = new FunctionalBufferSet();
  private _knowBlocks = new FunctionalBufferSet();
  private funcs: HandlerFunc[];

  protected handshakeResolve?: (result: boolean) => void;
  protected handshakeTimeout?: NodeJS.Timeout;
  protected readonly handshakePromise: Promise<boolean>;

  protected readonly waitingRequests = new Map<
    number,
    {
      resolve: (data: any) => void;
      reject: (reason?: any) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  private newBlockAnnouncesQueue = new Channel<{ block: Block; td: BN }>({
    max: c.maxQueuedBlocks
  });
  private txAnnouncesQueue = new Channel<Buffer>({ max: c.maxQueuedTxs });

  constructor(
    protocol: WireProtocol,
    peer: Peer,
    stream: ProtocolStream,
    funcs: HandlerFunc[]
  ) {
    this.peer = peer;
    this.stream = stream;
    this.protocol = protocol;
    this.funcs = funcs;

    this.handshakePromise = new Promise<boolean>((resolve) => {
      this.handshakeResolve = resolve;
    });
    this.handshakePromise.then((result) => {
      if (result) {
        this.protocol.pool.add(this);
        this.announceTx(this.node.txPool.getPooledTransactionHashes());
      }
    });

    this.newBlockAnnouncesLoop();
    this.txAnnouncesLoop();
  }

  get id() {
    return this.peer.peerId;
  }

  get status() {
    return this._status;
  }

  get node() {
    return this.protocol.node;
  }

  /**
   * Update node status
   * @param newStatus - New status
   */
  updateStatus(newStatus: Partial<NodeStatus>) {
    this._status = { ...this._status!, ...newStatus };
  }

  /**
   * Get method handler according to method name
   * @param method - Method name
   * @returns Handler function
   */
  protected findHandler(method: string | number) {
    const handler = this.funcs.find((h) =>
      typeof method === 'string' ? h.name === method : h.code === method
    );
    if (!handler) {
      throw new Error(`Missing handler, method: ${method}`);
    }
    return handler;
  }

  /**
   * {@link ProtocolHandler.handshake}
   */
  handshake() {
    if (!this.handshakeResolve) {
      throw new Error('repeated handshake');
    }
    this.send(0, this.node.status);
    this.handshakeTimeout = setTimeout(() => {
      this.handshakeTimeout = undefined;
      if (this.handshakeResolve) {
        this.handshakeResolve(false);
        this.handshakeResolve = undefined;
      }
    }, 2000);
    return this.handshakePromise;
  }

  /**
   * Handshake response callback
   * @param status - New node status
   */
  handshakeResponse(status: NodeStatus) {
    if (this.handshakeResolve) {
      const localStatus = this.node.status;
      const result =
        localStatus.genesisHash.equals(status.genesisHash) &&
        localStatus.networkId === status.networkId;
      if (result) {
        this.updateStatus(status);
      }
      this.handshakeResolve(result);
      this.handshakeResolve = undefined;
      if (this.handshakeTimeout) {
        clearTimeout(this.handshakeTimeout);
        this.handshakeTimeout = undefined;
      }
    }
  }

  /**
   * Send message to the remote peer
   * @param method - Method name or code
   * @param data - Message data
   */
  send(method: string | number, data: any) {
    const handler = this.findHandler(method);
    try {
      this.stream.send(
        rlp.encode([intToBuffer(handler.code), handler.encode.call(this, data)])
      );
    } catch (err) {
      // ignore errors
    }
  }

  /**
   * Send message to the peer and wait for the response
   * @param method - Method name
   * @param data - Message data
   * @returns Response
   */
  request(method: string, data: any) {
    const handler = this.findHandler(method);
    if (!handler.response) {
      throw new Error(`invalid request: ${method}`);
    }
    if (this.waitingRequests.has(handler.response!)) {
      throw new Error(`repeated request: ${method}`);
    }
    return new Promise<any>((resolve, reject) => {
      this.waitingRequests.set(handler.response!, {
        reject,
        resolve,
        timeout: setTimeout(() => {
          this.waitingRequests.delete(handler.response!);
          reject(new Error(`timeout request: ${method}`));
        }, 8000)
      });
      this.send(method, data);
    });
  }

  /**
   * {@link ProtocolHandler.abort}
   */
  abort() {
    if (this.handshakeResolve) {
      this.handshakeResolve(false);
      this.handshakeResolve = undefined;
      if (this.handshakeTimeout) {
        clearTimeout(this.handshakeTimeout);
        this.handshakeTimeout = undefined;
      }
    }

    for (const [, request] of this.waitingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('abort'));
    }
    this.waitingRequests.clear();

    this.newBlockAnnouncesQueue.abort();
    this.txAnnouncesQueue.abort();
    this.protocol.pool.remove(this);
  }

  /**
   * Handle the data received from the remote peer
   * @param data - Received data
   */
  async handle(data: Buffer) {
    try {
      const decoded = rlp.decode(data);
      if (!Array.isArray(decoded) || decoded.length !== 2) {
        throw new Error('invalid decoded values');
      }

      const [codeBuf, valuesArray]: any = decoded;
      const code = bufferToInt(codeBuf);
      const handler = this.findHandler(code);
      data = handler.decode.call(this, valuesArray);

      const request = this.waitingRequests.get(code);
      if (request) {
        clearTimeout(request.timeout);
        this.waitingRequests.delete(code);
        request.resolve(data);
      } else if (handler.process) {
        if (code !== 0 && !(await this.handshakePromise)) {
          logger.warn('WireProtocolHandler::handle, handshake failed');
          return;
        }

        const result = handler.process.call(this, data);
        if (result) {
          if (Array.isArray(result)) {
            const [method, resps] = result;
            this.send(method, resps);
          } else {
            result
              .then((response) => {
                if (response) {
                  const [method, resps] = response;
                  this.send(method, resps);
                }
              })
              .catch((err) => {
                logger.error('HandlerBase::process, catch error:', err);
              });
          }
        }
      }
    } catch (err) {
      logger.error('HandlerBase::handle, catch error:', err);
    }
  }

  private async newBlockAnnouncesLoop() {
    if (!(await this.handshakePromise)) {
      return;
    }

    for await (const { block, td } of this.newBlockAnnouncesQueue) {
      try {
        this.newBlock(block, td);
      } catch (err) {
        logger.error(
          'WireProtocolHandler::newBlockAnnouncesLoop, catch error:',
          err
        );
      }
    }
  }

  private async txAnnouncesLoop() {
    if (!(await this.handshakePromise)) {
      return;
    }

    let hashesCache: Buffer[] = [];
    for await (const hash of this.txAnnouncesQueue) {
      hashesCache.push(hash);
      if (
        hashesCache.length < c.maxTxPacketSize &&
        this.txAnnouncesQueue.array.length > 0
      ) {
        continue;
      }
      try {
        this.newPooledTransactionHashes(hashesCache);
      } catch (err) {
        logger.error('WireProtocolHandler::txAnnouncesLoop, catch error:', err);
      }
      hashesCache = [];
    }
  }

  /**
   * Filter known data
   * @param know - Known data
   * @param data - All data
   * @param toHash - Convert data to hash
   * @returns Filtered data
   */
  private filterHash<T>(
    know: Set<Buffer>,
    data: T[],
    toHash?: (t: T) => Buffer
  ) {
    const filtered: T[] = [];
    for (const t of data) {
      const hash = Buffer.isBuffer(t) ? t : toHash!(t);
      if (!know.has(hash)) {
        filtered.push(t);
      }
    }
    return filtered;
  }

  /**
   * filter out known transactions
   * @param data - All transactions
   * @param toHash - Convert data to hash
   * @returns Filtered transactions
   */
  private filterTxs<T>(data: T[], toHash?: (t: T) => Buffer) {
    return this.filterHash(this._knowTxs, data, toHash);
  }

  /**
   * Call filterHash, filter out known blocks
   * @param data - All blocks
   * @param toHash - Convert data to hash
   * @returns Filtered blocks
   */
  private filterBlocks<T>(data: T[], toHash?: (t: T) => Buffer) {
    return this.filterHash(this._knowBlocks, data, toHash);
  }

  /**
   * Add known data information
   * @param know - Previous data set
   * @param max - Maximum number of messages allowed to be stored
   * @param hashs - Data to be added
   */
  private knowHash(know: Set<Buffer>, max: number, hashs: Buffer[]) {
    if (hashs.length >= max) {
      throw new Error(
        `WireProtocolHandler invalid hash length: ${hashs.length}`
      );
    }
    while (know.size + hashs.length >= max) {
      const { value } = know.keys().next();
      know.delete(value);
    }
    for (const h of hashs) {
      know.add(h);
    }
  }

  /**
   * Call knowHash, add known transactions
   * @param hashs - Transactions to be added
   */
  knowTxs(hashs: Buffer[]) {
    this.knowHash(this._knowTxs, c.maxKnownTxs, hashs);
  }

  /**
   * Call knowHash, add known blocks
   * @param hashs - Blocks to be added
   */
  knowBlocks(hashs: Buffer[]) {
    this.knowHash(this._knowBlocks, c.maxKnownBlocks, hashs);
  }

  /**
   * Send new block message and add new block message to
   * the set of known set
   * @param block - New block
   * @param td - Total difficulty
   */
  private newBlock(block: Block, td: BN) {
    const filtered = this.filterBlocks([block], (b) => b.hash());
    if (filtered.length > 0) {
      this.send('NewBlock', { block, td });
      this.knowBlocks([block.hash()]);
    }
  }

  // private newBlockHashes(hashes: Buffer[]) {
  //   const filtered = this.filterBlocks(hashes, (h) => h);
  //   if (filtered.length > 0) {
  //     this.send('NewBlockHashes', filtered);
  //     this.knowBlocks(filtered);
  //   }
  // }

  /**
   * Send new transactions which added to the pool
   * and add them to the known transactions set
   * the set of known set
   * @param - hashes
   */
  private newPooledTransactionHashes(hashes: Buffer[]) {
    const filtered = this.filterTxs(hashes, (h) => h);
    if (filtered.length > 0) {
      this.send('NewPooledTransactionHashes', filtered);
      this.knowTxs(filtered);
    }
  }

  /**
   * Make a request to get block headers
   * @param start - Start block number
   * @param count - Wanted blocks number
   * @returns The block headers
   */
  getBlockHeaders(start: BN, count: BN): Promise<BlockHeader[]> {
    return this.request('GetBlockHeaders', { start, count });
  }

  /**
   * Make a request to get block bodies
   * @param headers - Headers of blocks which wanted
   * @returns The block bodies
   */
  getBlockBodies(headers: BlockHeader[]): Promise<Transaction[][]> {
    return this.request('GetBlockBodies', headers);
  }

  /**
   * Make a request to get pooled transactions
   * @param hashes - Transactions hashes
   * @returns Transactions
   */
  getPooledTransactions(hashes: Buffer[]): Promise<Transaction[]> {
    return this.request('GetPooledTransactions', hashes);
  }

  /**
   * Push transactions into txAnnouncesQueue
   * @param hashes - Transactions' hashes
   */
  announceTx(hashes: Buffer[]) {
    for (const hash of hashes) {
      this.txAnnouncesQueue.push(hash);
    }
  }

  /**
   * Push block into newBlockAnnouncesQueue
   * @param block - Block object
   * @param td - Total difficulty
   */
  announceNewBlock(block: Block, td: BN) {
    this.newBlockAnnouncesQueue.push({ block, td });
  }

  /**
   * Get remote peer status
   * @returns Status
   */
  getRemoteStatus() {
    const result = {
      name: this.protocol.name,
      version: Number(this.protocol.version)
    };
    if (!this.status) {
      return result;
    }
    return {
      ...result,
      difficulty: bufferToHex(this.status.totalDifficulty),
      head: bufferToHex(this.status.bestHash)
    };
  }
}
