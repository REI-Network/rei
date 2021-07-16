import { Address, BN } from 'ethereumjs-util';
import { HChannel, PChannel, logger, nowTimestamp } from '@gxchain2/utils';
import { emptyTxTrie, BlockHeader, Block } from '@gxchain2/structure';
import { Node } from '../../node';
import { PeerRequestTimeoutError, WireProtocol, WireProtocolHandler } from '../../protocols';

const allowedFutureBlockTimeSeconds = 15;

export interface FetcherOptions {
  node: Node;
  count: number;
  limit: number;
}

/**
 * Fetcher is responsible for retrieving new blocks based on announcements.
 */
export class Fetcher {
  private aborted: boolean = false;
  private node: Node;
  private count: number;

  private downloadLimit: number;
  private downloadParallel: number = 0;
  private downloadParallelResolve?: () => void;
  private downloadBodiesPromises = new Set<Promise<void>>();

  private processLimit: number = 1;
  private processParallel: number = 0;
  private processParallelResolve?: () => void;
  private processParallelPromise?: Promise<void>;

  private remote!: string;
  private localHeight!: number;
  private bestHeight!: number;
  private totalTD!: BN;
  private bestTD!: BN;

  private blockQueue: PChannel<Block>;
  private downloadBodiesQueue: HChannel<BlockHeader>;
  private uselessHandlers = new Set<WireProtocolHandler>();

  constructor(options: FetcherOptions) {
    this.node = options.node;
    this.count = options.count;
    this.downloadLimit = options.limit;
    this.blockQueue = new PChannel<Block>();
    this.downloadBodiesQueue = new HChannel<BlockHeader>({
      compare: (a, b) => a.number.lt(b.number)
    });
  }

  /**
   * Fetch blocks from specified peer
   */
  async fetch(localHeight: number, localHash: Buffer, localTD: BN, bestHeight: number, bestTD: BN, handler: WireProtocolHandler) {
    this.remote = handler.peer.peerId;
    this.localHeight = localHeight;
    this.bestHeight = bestHeight;
    this.totalTD = localTD.clone();
    this.bestTD = bestTD.clone();
    try {
      await Promise.all([this.downloadHeader(localHeight, localHash, bestHeight - localHeight, handler), this.downloadBodiesLoop(), this.processBlockLoop()]);
      await Promise.all(Array.from(this.downloadBodiesPromises));
    } catch (err) {
      throw err;
    } finally {
      for (const handler of this.uselessHandlers) {
        WireProtocol.getPool().put(handler);
      }
      this.uselessHandlers.clear();
    }
  }

  /**
   * Reset fetch, clear up Queues
   */
  reset() {
    this.aborted = false;
    this.downloadBodiesQueue.reset();
    this.blockQueue.reset();
  }

  /**
   * Abort fetch
   */
  abort() {
    logger.debug('Fetcher::abort');
    this.aborted = true;
    if (this.downloadParallelResolve) {
      this.downloadParallelResolve();
      this.downloadParallelResolve = undefined;
    }
    if (this.processParallelResolve) {
      this.processParallelResolve();
      this.processParallelResolve = undefined;
      this.processParallelPromise = undefined;
    }
    this.downloadBodiesQueue.abort();
    this.blockQueue.abort();
  }

  /**
   * Download block headers
   * @param start Start block height
   * @param count Total blockheaders amount
   * @param handler Peer's WireProtocolHandler
   */
  private async downloadHeader(localHeight: number, localHash: Buffer, totalCount: number, handler: WireProtocolHandler) {
    let i = 0;
    const headerTaskQueue: { start: number; count: number }[] = [];
    while (totalCount > 0) {
      headerTaskQueue.push({
        start: i * this.count + localHeight + 1,
        count: totalCount > this.count ? this.count : totalCount
      });
      i++;
      totalCount -= this.count;
    }

    let lastHash = localHash;
    for (const { start, count } of headerTaskQueue) {
      if (this.aborted) {
        return;
      }
      let headers: BlockHeader[];
      try {
        headers = await handler.getBlockHeaders(start, count);
      } catch (err) {
        if (err instanceof PeerRequestTimeoutError) {
          await this.node.banPeer(handler.peer.peerId, 'timeout');
        } else {
          logger.warn('Fetcher::downloadHeader, catch error:', err);
        }
        this.abort();
        return;
      }
      try {
        if (headers.length !== count) {
          throw new Error('invalid header(length)');
        }
        for (let index = 0; i < headers.length; i++) {
          const header = headers[index];
          if (index > 0) {
            if (!headers[index - 1].hash().equals(header.parentHash)) {
              throw new Error('invalid header(parentHash)');
            }
          } else {
            if (!header.parentHash.equals(lastHash)) {
              throw new Error('invalid header(parentHash)');
            }
          }
          await header.validate(this.node.blockchain);
          // additional check for signer
          if (!header.cliqueVerifySignature(this.node.blockchain.cliqueActiveSigners())) {
            throw new Error('invalid header(signers)');
          }
          // additional check for beneficiary
          if (!header.nonce.equals(Buffer.alloc(8)) || !header.coinbase.equals(Address.zero())) {
            throw new Error('invalid header(nonce or coinbase), currently does not support beneficiary');
          }
          // additional check for gasLimit
          if (!header.gasLimit.eq(this.node.miner.gasLimit)) {
            throw new Error('invalid header(gas limit)');
          }
          // additional check for timestamp
          if (!header.timestamp.gtn(nowTimestamp() + allowedFutureBlockTimeSeconds)) {
            throw new Error('invalid header(timestamp)');
          }
          this.totalTD.iadd(header.difficulty);
          if (index === headers.length - 1) {
            lastHash = header.hash();
            if (header.number.toNumber() === this.bestHeight) {
              if (this.totalTD.lt(this.bestTD)) {
                throw new Error('invalid header(total difficulty)');
              }
            }
          }
        }
        logger.info('Download headers start:', start, 'count:', count, 'from:', handler.peer.peerId);
        for (const header of headers) {
          this.downloadBodiesQueue.push(header);
        }
      } catch (err) {
        logger.warn('Fetcher::downloadHeader, catch error:', err);
        this.abort();
        await this.node.banPeer(handler.peer.peerId, 'invalid');
        return;
      }
      if (this.processParallelPromise) {
        await this.processParallelPromise;
      }
    }
  }

  /**
   * Download blockbodies according to the block headers
   */
  private async downloadBodiesLoop() {
    let headersCache: BlockHeader[] = [];
    for await (const header of this.downloadBodiesQueue.generator()) {
      headersCache.push(header);
      if (headersCache.length < this.count && this.downloadBodiesQueue.heap.length > 0) {
        continue;
      }
      const headers = [...headersCache];
      headersCache = [];

      let handler: WireProtocolHandler;
      try {
        handler = await WireProtocol.getPool().get();
      } catch (err) {
        logger.warn('Fetcher::downloadBodiesLoop, catch error:', err);
        this.abort();
        return;
      }
      this.downloadParallel++;
      const p = this.downloadBodies(handler, headers, () => {
        this.downloadBodiesPromises.delete(p);
        if (--this.downloadParallel < this.downloadLimit && this.downloadParallelResolve) {
          this.downloadParallelResolve();
          this.downloadParallelResolve = undefined;
        }
      });
      this.downloadBodiesPromises.add(p);
      if (this.downloadParallel >= this.downloadLimit) {
        await new Promise<void>((resolve) => {
          this.downloadParallelResolve = resolve;
        });
      }
      if (this.processParallelPromise) {
        await this.processParallelPromise;
      }
    }
  }

  private downloadBodies(handler: WireProtocolHandler, headers: BlockHeader[], over: () => void) {
    const retry = () => {
      if (!this.aborted) {
        for (const header of headers) {
          this.downloadBodiesQueue.push(header);
        }
      }
    };
    return handler
      .getBlockBodies(headers)
      .then(async (bodies) => {
        over();

        if (bodies.length !== headers.length) {
          logger.warn('Fetcher::downloadBodiesLoop, invalid bodies(length)');
          await this.node.banPeer(handler.peer.peerId, 'invalid');
          return retry();
        }
        const blocks: Block[] = [];
        for (let i = 0; i < bodies.length; i++) {
          try {
            const transactions = bodies[i];
            const header = headers[i];
            const block = Block.fromBlockData({ header, transactions }, { common: this.node.getCommon(header.number), hardforkByBlockNumber: true });
            // the target peer does not have the block body, so it is marked as a useless peer.
            if (!block.header.transactionsTrie.equals(emptyTxTrie) && transactions.length === 0) {
              this.uselessHandlers.add(handler);
              logger.debug('Fetcher, ', handler.peer.peerId, 'add to useless peer');
              return retry();
            }
            await block.validateData();
            // additional check for uncle headers
            if (block.uncleHeaders.length !== 0) {
              throw new Error('invalid block(uncle headers)');
            }
            blocks.push(block);
          } catch (err) {
            logger.warn('Fetcher::downloadBodies, catch error:', err);
            await this.node.banPeer(handler.peer.peerId, 'invalid');
            return retry();
          }
        }
        logger.info('Download bodies start:', headers[0].number.toNumber(), 'count:', headers.length, 'from:', handler.peer.peerId);
        if (!this.aborted) {
          for (const block of blocks) {
            this.pushToBlockQueue(block);
          }
        }
        WireProtocol.getPool().put(handler);
      })
      .catch((err) => {
        over();

        if (err instanceof PeerRequestTimeoutError) {
          this.node.banPeer(handler.peer.peerId, 'timeout');
        } else {
          // TODO: put handler to pool.
          logger.warn('Fetcher::downloadBodies, download failed error:', err);
        }
        return retry();
      });
  }

  private pushToBlockQueue(block: Block) {
    this.processParallel++;
    this.blockQueue.push({ data: block, index: block.header.number.toNumber() - this.localHeight - 1 });
    if (this.processParallel >= this.processLimit && !this.processParallelPromise) {
      this.processParallelPromise = new Promise<void>((resolve) => {
        this.processParallelResolve = resolve;
      });
    }
  }

  private blockProcessed() {
    this.processParallel--;
    if (this.processParallel < this.processLimit && this.processParallelResolve) {
      this.processParallelResolve();
      this.processParallelResolve = undefined;
      this.processParallelPromise = undefined;
    }
  }

  private async processBlockLoop() {
    for await (const { data: block } of this.blockQueue.generator()) {
      try {
        await this.node.processBlock(block, { generate: false, broadcast: false });
        this.blockProcessed();
        if (block.header.number.eqn(this.bestHeight)) {
          this.abort();
        }
      } catch (err) {
        logger.error('Fetcher::processBlockLoop, process block error:', err);
        this.abort();
        this.node.banPeer(this.remote, 'timeout');
        return;
      }
    }
  }
}
