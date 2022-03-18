import { bufferToInt, rlp, BN, intToBuffer, bnToUnpaddedBuffer } from 'ethereumjs-util';
import { mustParseTransction, Transaction, Block, BlockHeader, BlockHeaderBuffer, TransactionsBuffer } from '@rei-network/structure';
import { logger, Channel, FunctionalBufferSet } from '@rei-network/utils';
import { ProtocolHandler, Peer } from '@rei-network/network';
import { NodeStatus } from '../../types';
import { WireProtocol } from './protocol';

const maxTxPacketSize = 102400;
const maxKnownTxs = 32768;
const maxKnownBlocks = 1024;
const maxQueuedTxs = 4096;
const maxQueuedBlocks = 4;

export const maxGetBlockHeaders = 128;
export const maxTxRetrievals = 256;

type HandlerFunc = {
  name: string;
  code: number;
  response?: number;
  encode(data: any): any;
  decode(data: any): any;
  process?: (data: any) => Promise<[string, any]> | Promise<[string, any] | void> | [string, any] | void;
};

const wireHandlerFuncs: HandlerFunc[] = [
  {
    name: 'Status',
    code: 0,
    encode(this: WireProtocolHandler, data: NodeStatus) {
      const payload: any = Object.entries(data).map(([k, v]) => [k, v]);
      return payload;
    },
    decode(this: WireProtocolHandler, data): NodeStatus {
      const status: any = {};
      data.forEach(([k, v]: any) => {
        status[k.toString()] = v;
      });
      return {
        networkId: bufferToInt(status.networkId),
        totalDifficulty: status.totalDifficulty,
        height: bufferToInt(status.height),
        bestHash: status.bestHash,
        genesisHash: status.genesisHash
      };
    },
    process(this: WireProtocolHandler, status: NodeStatus) {
      this.handshakeResponse(status);
    }
  },
  {
    name: 'GetBlockHeaders',
    code: 1,
    response: 2,
    encode(this: WireProtocolHandler, { start, count }: { start: BN; count: BN }) {
      return [bnToUnpaddedBuffer(start), bnToUnpaddedBuffer(count)];
    },
    decode(this: WireProtocolHandler, [start, count]: Buffer[]) {
      return { start: new BN(start), count: new BN(count) };
    },
    async process(this: WireProtocolHandler, { start, count }: { start: BN; count: BN }): Promise<[string, BlockHeader[]] | void> {
      if (count.gtn(maxGetBlockHeaders)) {
        this.node.banPeer(this.peer.peerId, 'invalid');
        return;
      }

      const headers: BlockHeader[] = [];
      for (const n = start.clone(); ; n.iaddn(1)) {
        try {
          headers.push(await this.node.db.getCanonicalHeader(n));
        } catch (err) {
          // ignore all errors ...
          break;
        }

        if (headers.length >= count.toNumber()) {
          break;
        }
      }
      return ['BlockHeaders', headers];
    }
  },
  {
    name: 'BlockHeaders',
    code: 2,
    encode(this: WireProtocolHandler, headers: BlockHeader[]) {
      return headers.map((h) => h.raw());
    },
    decode(this: WireProtocolHandler, headers: BlockHeaderBuffer[]) {
      return headers.map((h) => BlockHeader.fromValuesArray(h, { common: this.node.getCommon(0), hardforkByBlockNumber: true }));
    }
  },
  {
    name: 'GetBlockBodies',
    code: 3,
    response: 4,
    encode(this: WireProtocolHandler, headers: BlockHeader[]) {
      return headers.map((h) => h.hash());
    },
    decode(this: WireProtocolHandler, headerHashs: Buffer[]) {
      return headerHashs;
    },
    async process(this: WireProtocolHandler, headerHashs: Buffer[]): Promise<[string, Transaction[][]] | void> {
      if (headerHashs.length > maxGetBlockHeaders) {
        this.node.banPeer(this.peer.peerId, 'invalid');
        return;
      }
      const bodies: Transaction[][] = [];
      for (const hash of headerHashs) {
        try {
          const block = await this.node.db.getBlock(hash);
          bodies.push(block.transactions as Transaction[]);
        } catch (err: any) {
          if (err.type !== 'NotFoundError') {
            throw err;
          }
          bodies.push([]);
        }
      }
      return ['BlockBodies', bodies];
    }
  },
  {
    name: 'BlockBodies',
    code: 4,
    encode(this: WireProtocolHandler, bodies: Transaction[][]) {
      return bodies.map((txs) => {
        return txs.map((tx) => tx.raw() as Buffer[]);
      });
    },
    decode(this: WireProtocolHandler, bodies: TransactionsBuffer[]): Transaction[][] {
      return bodies.map((txs) => {
        return txs.map((tx) => mustParseTransction(tx, { common: this.node.getCommon(0) }));
      });
    }
  },
  {
    name: 'NewBlock',
    code: 5,
    encode(this: WireProtocolHandler, { block, td }: { block: Block; td: BN }) {
      return [[block.header.raw(), block.transactions.map((tx) => tx.raw() as Buffer[])], td.toBuffer()];
    },
    decode(this: WireProtocolHandler, raw): { block: Block; td: BN } {
      return {
        block: Block.fromValuesArray(raw[0], { common: this.node.getCommon(0), hardforkByBlockNumber: true }),
        td: new BN(raw[1])
      };
    },
    process(this: WireProtocolHandler, { block, td }: { block: Block; td: BN }) {
      const height = block.header.number.toNumber();
      const bestHash = block.hash();
      this.knowBlocks([bestHash]);
      const totalDifficulty = td.toBuffer();
      this.updateStatus({ height, bestHash, totalDifficulty });
      this.node.sync.announce(this);
    }
  },
  {
    name: 'NewPooledTransactionHashes',
    code: 6,
    encode(this: WireProtocolHandler, hashes: Buffer[]) {
      return [...hashes];
    },
    decode(this: WireProtocolHandler, hashes): Buffer[] {
      return hashes;
    },
    process(this: WireProtocolHandler, hashes: Buffer[]) {
      if (hashes.length > maxTxPacketSize) {
        this.node.banPeer(this.peer.peerId, 'invalid');
        return;
      }
      this.knowTxs(hashes);
      this.node.txSync.newPooledTransactionHashes(this.peer.peerId, hashes);
    }
  },
  {
    name: 'GetPooledTransactions',
    code: 7,
    response: 8,
    encode(this: WireProtocolHandler, hashes: Buffer[]) {
      return [...hashes];
    },
    decode(this: WireProtocolHandler, hashes): Buffer[] {
      return hashes;
    },
    process(this: WireProtocolHandler, hashes: Buffer[]) {
      if (hashes.length > maxTxRetrievals) {
        this.node.banPeer(this.peer.peerId, 'invalid');
        return;
      }
      return ['PooledTransactions', hashes.map((hash) => this.node.txPool.getTransaction(hash)).filter((tx) => tx !== undefined)];
    }
  },
  {
    name: 'PooledTransactions',
    code: 8,
    encode(this: WireProtocolHandler, txs: Transaction[]) {
      return txs.map((tx) => tx.raw() as Buffer[]);
    },
    decode(this: WireProtocolHandler, raws: TransactionsBuffer) {
      return raws.map((raw) => mustParseTransction(raw, { common: this.node.getLatestCommon() }));
    }
  }
];

/**
 * WireProtocolHandler is used to manage protocol communication between nodes
 */
export class WireProtocolHandler implements ProtocolHandler {
  readonly peer: Peer;
  readonly protocol: WireProtocol;

  private _status?: NodeStatus;
  private _knowTxs = new FunctionalBufferSet();
  private _knowBlocks = new FunctionalBufferSet();

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

  private newBlockAnnouncesQueue: Channel<{ block: Block; td: BN }>;
  private txAnnouncesQueue: Channel<Buffer>;

  constructor(protocol: WireProtocol, peer: Peer) {
    this.peer = peer;
    this.protocol = protocol;
    this.newBlockAnnouncesQueue = new Channel<{ block: Block; td: BN }>({ max: maxQueuedBlocks });
    this.txAnnouncesQueue = new Channel<Buffer>({ max: maxQueuedTxs });

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
   * Get method hander according to method name
   * @param method - Method name
   * @returns Handler function
   */
  protected findHandler(method: string | number) {
    const handler = wireHandlerFuncs.find((h) => (typeof method === 'string' ? h.name === method : h.code === method));
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
      const result = localStatus.genesisHash.equals(status.genesisHash) && localStatus.networkId === status.networkId;
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
      this.peer.send(this.protocol.name, rlp.encode([intToBuffer(handler.code), handler.encode.call(this, data)]));
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
        logger.warn('WireProtocolHander::handle, handshake failed');
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
  }

  private async newBlockAnnouncesLoop() {
    if (!(await this.handshakePromise)) {
      return;
    }

    for await (const { block, td } of this.newBlockAnnouncesQueue) {
      try {
        this.newBlock(block, td);
      } catch (err) {
        logger.error('WireProtocolHandler::newBlockAnnouncesLoop, catch error:', err);
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
      if (hashesCache.length < maxTxPacketSize && this.txAnnouncesQueue.array.length > 0) {
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
  private filterHash<T>(know: Set<Buffer>, data: T[], toHash?: (t: T) => Buffer) {
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
      throw new Error(`WireProtocolHandler invalid hash length: ${hashs.length}`);
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
    this.knowHash(this._knowTxs, maxKnownTxs, hashs);
  }

  /**
   * Call knowHash, add known blocks
   * @param hashs - Blocks to be added
   */
  knowBlocks(hashs: Buffer[]) {
    this.knowHash(this._knowBlocks, maxKnownBlocks, hashs);
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
}
