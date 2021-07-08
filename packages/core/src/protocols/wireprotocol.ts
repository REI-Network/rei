import { bufferToInt, rlp, BN } from 'ethereumjs-util';
import { TxFromValuesArray, TypedTransaction, Block, BlockHeader, BlockHeaderBuffer, TransactionsBuffer } from '@gxchain2/structure';
import { logger, Channel, createBufferFunctionalSet } from '@gxchain2/utils';
import { ProtocolHandler, Peer, MsgQueue } from '@gxchain2/network';
import { Node, NodeStatus } from '../node';
import { WireProtocol } from './index';

const maxTxPacketSize = 102400;
const maxKnownTxs = 32768;
const maxKnownBlocks = 1024;
const maxQueuedTxs = 4096;
const maxQueuedBlocks = 4;

export const maxGetBlockHeaders = 128;
export const maxTxRetrievals = 256;

export class PeerRequestTimeoutError extends Error {}

type Handler = {
  name: string;
  code: number;
  response?: number;
  encode(data: any): any;
  decode(data: any): any;
  process?: (data: any) => Promise<[string, any]> | Promise<[string, any] | void> | [string, any] | void;
};

const wireHandlers: Handler[] = [
  {
    name: 'Status',
    code: 0,
    encode(this: WireProtocolHandler, data: NodeStatus) {
      const payload: any = Object.entries(data).map(([k, v]) => [k, v]);
      return [0, payload];
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
    encode(this: WireProtocolHandler, { start, count }: { start: number; count: number }) {
      return [1, [start, count]];
    },
    decode(this: WireProtocolHandler, [start, count]: Buffer[]) {
      return { start: bufferToInt(start), count: bufferToInt(count) };
    },
    async process(this: WireProtocolHandler, { start, count }: { start: number; count: number }): Promise<[string, BlockHeader[]] | void> {
      if (count > maxGetBlockHeaders) {
        this.node.banPeer(this.peer.peerId, 'invalid');
        return;
      }
      const blocks = await this.node.blockchain.getBlocks(start, count, 0, false);
      return ['BlockHeaders', blocks.map((b) => b.header)];
    }
  },
  {
    name: 'BlockHeaders',
    code: 2,
    encode(this: WireProtocolHandler, headers: BlockHeader[]) {
      return [2, headers.map((h) => h.raw())];
    },
    decode(this: WireProtocolHandler, headers: BlockHeaderBuffer[]) {
      return headers.map((h) => BlockHeader.fromValuesArray(h, { common: this.node.getCommon(0) }));
    }
  },
  {
    name: 'GetBlockBodies',
    code: 3,
    response: 4,
    encode(this: WireProtocolHandler, headers: BlockHeader[]) {
      return [3, headers.map((h) => h.hash())];
    },
    decode(this: WireProtocolHandler, headerHashs: Buffer[]) {
      return headerHashs;
    },
    async process(this: WireProtocolHandler, headerHashs: Buffer[]): Promise<[string, TypedTransaction[][]] | void> {
      if (headerHashs.length > maxGetBlockHeaders) {
        this.node.banPeer(this.peer.peerId, 'invalid');
        return;
      }
      const bodies: TypedTransaction[][] = [];
      for (const hash of headerHashs) {
        try {
          const block = await this.node.db.getBlock(hash);
          bodies.push(block.transactions);
        } catch (err) {
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
    encode(this: WireProtocolHandler, bodies: TypedTransaction[][]) {
      return [
        4,
        bodies.map((txs) => {
          return txs.map((tx) => tx.raw() as Buffer[]);
        })
      ];
    },
    decode(this: WireProtocolHandler, bodies: TransactionsBuffer[]): TypedTransaction[][] {
      return bodies.map((txs) => {
        return txs.map((tx) => TxFromValuesArray(tx, { common: this.node.getCommon(0) }));
      });
    }
  },
  {
    name: 'NewBlock',
    code: 5,
    encode(this: WireProtocolHandler, { block, td }: { block: Block; td: BN }) {
      return [5, [[block.header.raw(), block.transactions.map((tx) => tx.raw() as Buffer[])], td.toBuffer()]];
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
      this.node.sync.announce(this.peer);
    }
  },
  {
    name: 'NewPooledTransactionHashes',
    code: 6,
    encode(this: WireProtocolHandler, hashes: Buffer[]) {
      return [6, [...hashes]];
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
      return [7, [...hashes]];
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
    encode(this: WireProtocolHandler, txs: TypedTransaction[]) {
      return [8, txs.map((tx) => tx.raw() as Buffer[])];
    },
    decode(this: WireProtocolHandler, raws: TransactionsBuffer) {
      return raws.map((raw) => TxFromValuesArray(raw, { common: this.node.getCommon(0) }));
    }
  }
];

function findHandler(method: string | number) {
  const handler = wireHandlers.find((h) => (typeof method === 'string' ? h.name === method : h.code === method));
  if (!handler) {
    throw new Error(`Missing handler, method: ${method}`);
  }
  return handler;
}

export class WireProtocolHandler implements ProtocolHandler {
  readonly node: Node;
  readonly peer: Peer;
  readonly name: string;
  private _status?: NodeStatus;

  private queue?: MsgQueue;
  private readonly waitingRequests = new Map<
    number,
    {
      resolve: (data: any) => void;
      reject: (reason?: any) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  private _knowTxs = createBufferFunctionalSet();
  private _knowBlocks = createBufferFunctionalSet();

  private handshakeResolve?: (result: boolean) => void;
  private handshakeTimeout?: NodeJS.Timeout;
  private readonly handshakePromise: Promise<boolean>;

  private newBlockAnnouncesQueue: Channel<{ block: Block; td: BN }>;
  private txAnnouncesQueue: Channel<Buffer>;

  get status() {
    return this._status;
  }

  constructor(options: { node: Node; name: string; peer: Peer }) {
    this.node = options.node;
    this.peer = options.peer;
    this.name = options.name;
    this.handshakePromise = new Promise<boolean>((resolve) => {
      this.handshakeResolve = resolve;
    });
    this.handshakePromise.then((result) => {
      if (result) {
        WireProtocol.getPool().add(this);
        this.announceTx(this.node.txPool.getPooledTransactionHashes());
      }
    });
    this.newBlockAnnouncesQueue = new Channel<{ block: Block; td: BN }>({ max: maxQueuedBlocks });
    this.txAnnouncesQueue = new Channel<Buffer>({ max: maxQueuedTxs });
    this.newBlockAnnouncesLoop();
    this.txAnnouncesLoop();
  }

  private async newBlockAnnouncesLoop() {
    if (!(await this.handshakePromise)) {
      return;
    }
    for await (const { block, td } of this.newBlockAnnouncesQueue.generator()) {
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
    for await (const hash of this.txAnnouncesQueue.generator()) {
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

  private getMsgQueue() {
    return this.queue ? this.queue : (this.queue = this.peer.getMsgQueue(this.name));
  }

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

  private filterTxs<T>(data: T[], toHash?: (t: T) => Buffer) {
    return this.filterHash(this._knowTxs, data, toHash);
  }

  private filterBlocks<T>(data: T[], toHash?: (t: T) => Buffer) {
    return this.filterHash(this._knowBlocks, data, toHash);
  }

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

  knowTxs(hashs: Buffer[]) {
    this.knowHash(this._knowTxs, maxKnownTxs, hashs);
  }

  knowBlocks(hashs: Buffer[]) {
    this.knowHash(this._knowBlocks, maxKnownBlocks, hashs);
  }

  updateStatus(newStatus: Partial<NodeStatus>) {
    this._status = { ...this._status!, ...newStatus };
  }

  handshake() {
    if (!this.handshakeResolve) {
      throw new Error('WireProtocolHandler repeat handshake');
    }
    this.getMsgQueue().send(0, this.node.status);
    this.handshakeTimeout = setTimeout(() => {
      if (this.handshakeResolve) {
        this.handshakeResolve(false);
        this.handshakeResolve = undefined;
      }
    }, 8000);
    return this.handshakePromise;
  }

  handshakeResponse(status: NodeStatus) {
    if (this.handshakeResolve) {
      this.updateStatus(status);
      this.handshakeResolve(true);
      this.handshakeResolve = undefined;
      if (this.handshakeTimeout) {
        clearTimeout(this.handshakeTimeout);
        this.handshakeTimeout = undefined;
      }
    }
  }

  request(method: string, data: any) {
    const handler = findHandler(method);
    if (!handler.response) {
      throw new Error(`WireProtocolHandler invalid request: ${method}`);
    }
    if (this.waitingRequests.has(handler.response!)) {
      throw new Error(`WireProtocolHandler repeated request: ${method}`);
    }
    return new Promise<any>((resolve, reject) => {
      this.waitingRequests.set(handler.response!, {
        reject,
        resolve,
        timeout: setTimeout(() => {
          this.waitingRequests.delete(handler.response!);
          reject(new PeerRequestTimeoutError(`WireProtocolHandler timeout request: ${method}`));
        }, 8000)
      });
      this.getMsgQueue().send(method, data);
    });
  }

  abort() {
    if (this.handshakeResolve) {
      this.handshakeResolve(false);
      this.handshakeResolve = undefined;
      if (this.handshakeTimeout) {
        clearTimeout(this.handshakeTimeout);
        this.handshakeTimeout = undefined;
      }
    }
    for (const [response, request] of this.waitingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('WireProtocolHandler abort'));
    }
    this.waitingRequests.clear();
    this.newBlockAnnouncesQueue.abort();
    this.txAnnouncesQueue.abort();
    WireProtocol.getPool().remove(this);
  }

  encode(method: string | number, data: any) {
    return rlp.encode(findHandler(method).encode.call(this, data));
  }

  async handle(data: Buffer) {
    const [code, payload]: any = rlp.decode(data);
    const numCode = bufferToInt(code);
    const handler = findHandler(numCode);
    data = handler.decode.call(this, payload);

    const request = this.waitingRequests.get(numCode);
    if (request) {
      clearTimeout(request.timeout);
      this.waitingRequests.delete(numCode);
      request.resolve(data);
    } else if (handler.process) {
      if (numCode !== 0 && !(await this.handshakePromise)) {
        logger.warn('WireProtocolHandler::handle, handshake failed');
        return;
      }
      const result = handler.process.call(this, data);
      if (result) {
        if (Array.isArray(result)) {
          const [method, resps] = result;
          this.getMsgQueue().send(method, resps);
        } else {
          result
            .then((response) => {
              if (response) {
                const [method, resps] = response;
                this.getMsgQueue().send(method, resps);
              }
            })
            .catch((err) => {
              logger.error('WireProtocolHandler::process, catch error:', err);
            });
        }
      }
    }
  }

  private newBlock(block: Block, td: BN) {
    const filtered = this.filterBlocks([block], (b) => b.hash());
    if (filtered.length > 0) {
      this.getMsgQueue().send('NewBlock', { block, td });
      this.knowBlocks([block.hash()]);
    }
  }

  private newBlockHashes(hashes: Buffer[]) {
    const filtered = this.filterBlocks(hashes, (h) => h);
    if (filtered.length > 0) {
      this.getMsgQueue().send('NewBlockHashes', filtered);
      this.knowBlocks(filtered);
    }
  }

  private newPooledTransactionHashes(hashes: Buffer[]) {
    const filtered = this.filterTxs(hashes, (h) => h);
    if (filtered.length > 0) {
      this.getMsgQueue().send('NewPooledTransactionHashes', filtered);
      this.knowTxs(filtered);
    }
  }

  getBlockHeaders(start: number, count: number): Promise<BlockHeader[]> {
    return this.request('GetBlockHeaders', { start, count });
  }

  getBlockBodies(headers: BlockHeader[]): Promise<TypedTransaction[][]> {
    return this.request('GetBlockBodies', headers);
  }

  getPooledTransactions(hashes: Buffer[]): Promise<TypedTransaction[]> {
    return this.request('GetPooledTransactions', hashes);
  }

  announceTx(hashes: Buffer[]) {
    for (const hash of hashes) {
      this.txAnnouncesQueue.push(hash);
    }
  }

  announceNewBlock(block: Block, td: BN) {
    this.newBlockAnnouncesQueue.push({ block, td });
  }
}
