import { Address } from 'ethereumjs-util';
import { HChannel, PChannel, logger } from '@gxchain2/utils';
import { emptyTxTrie, BlockHeader, Block } from '@gxchain2/structure';
import { Node } from '../../node';
import { PeerRequestTimeoutError, WireProtocol, WireProtocolHandler } from '../../protocols';

export interface FetcherOptions {
  node: Node;
  count: number;
  limit: number;
}

export class Fetcher {
  private abortFlag: boolean = false;
  private node: Node;
  private count: number;

  private downloadLimit: number;
  private downloadParallel: number = 0;
  private downloadParallelResolve?: () => void;

  private processLimit: number = 10;
  private processParallel: number = 0;
  private processParallelResolve?: () => void;
  private processParallelPromise?: Promise<void>;

  private localHeight!: number;
  private bestHeight!: number;

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
   * @param start - start height of sync
   * @param count - sync block count
   * @param handler - best peer handler
   */
  async fetch(start: number, count: number, handler: WireProtocolHandler) {
    this.bestHeight = start + count;
    this.localHeight = start;
    try {
      await Promise.all([this.downloadHeader(start, count, handler), this.downloadBodiesLoop(), this.processBlockLoop()]);
    } catch (err) {
      throw err;
    } finally {
      for (const handler of this.uselessHandlers) {
        WireProtocol.getPool().put(handler);
      }
      this.uselessHandlers.clear();
    }
  }

  reset() {
    this.abortFlag = false;
    this.downloadBodiesQueue.reset();
    this.blockQueue.reset();
  }

  abort() {
    logger.debug('Fetcher::abort');
    this.abortFlag = true;
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

  private async downloadHeader(start: number, count: number, handler: WireProtocolHandler) {
    let i = 0;
    const headerTaskQueue: { start: number; count: number }[] = [];
    while (count > 0) {
      headerTaskQueue.push({
        start: i * this.count + start + 1,
        count: count > this.count ? this.count : count
      });
      i++;
      count -= this.count;
    }

    for (const { start, count } of headerTaskQueue) {
      if (this.abortFlag) {
        return;
      }
      try {
        const headers: BlockHeader[] = await handler.getBlockHeaders(start, count);
        if (headers.length !== count) {
          logger.warn('Fetcher::downloadHeader, invalid header(length)');
          this.abort();
          await this.node.banPeer(handler.peer.peerId, 'invalid');
          return;
        }
        for (let index = 1; i < headers.length; i++) {
          if (!headers[index - 1].hash().equals(headers[index].parentHash)) {
            logger.warn('Fetcher::downloadHeader, invalid header(parentHash)');
            this.abort();
            await this.node.banPeer(handler.peer.peerId, 'invalid');
            return;
          }
        }
        logger.info('Download headers start:', start, 'count:', count, 'from:', handler.peer.peerId);
        for (const header of headers) {
          this.downloadBodiesQueue.push(header);
        }
      } catch (err) {
        logger.error('Fetcher::downloadHeader, catch error:', err);
        this.abort();
        await this.node.banPeer(handler.peer.peerId, err instanceof PeerRequestTimeoutError ? 'timeout' : 'error');
        return;
      }
      if (this.processParallelPromise) {
        await this.processParallelPromise;
      }
    }
  }

  private async downloadBodiesLoop() {
    let headersCache: BlockHeader[] = [];
    for await (const header of this.downloadBodiesQueue.generator()) {
      headersCache.push(header);
      if (headersCache.length < this.count && this.downloadBodiesQueue.heap.length > 0) {
        continue;
      }
      const headers = [...headersCache];
      headersCache = [];

      const handler = await WireProtocol.getPool().get();

      const retry = () => {
        if (!this.abortFlag) {
          for (const header of headers) {
            this.downloadBodiesQueue.push(header);
          }
        }
      };
      this.downloadParallel++;

      handler
        .getBlockBodies(headers)
        .then(async (bodies) => {
          this.downloadParallel--;
          if (this.downloadParallelResolve) {
            this.downloadParallelResolve();
            this.downloadParallelResolve = undefined;
          }

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
              // additional check for beneficiary
              if (!block.header.nonce.equals(Buffer.alloc(8)) || !block.header.coinbase.equals(Address.zero())) {
                throw new Error('invalid nonce or coinbase, currently does not support beneficiary');
              }
              // additional check for gasLimit
              if (!block.header.gasLimit.eq(this.node.miner.gasLimit)) {
                throw new Error('invalid gasLimit');
              }
              blocks.push(block);
            } catch (err) {
              logger.warn('Fetcher::downloadBodiesLoop, invalid bodies(validateData)', err);
              await this.node.banPeer(handler.peer.peerId, 'invalid');
              return retry();
            }
          }
          logger.info('Download bodies start:', headers[0].number.toNumber(), 'count:', headers.length, 'from:', handler.peer.peerId);
          if (!this.abortFlag) {
            for (const block of blocks) {
              this.blockQueue.push({ data: block, index: block.header.number.toNumber() - this.localHeight - 1 });
            }
          }
          WireProtocol.getPool().put(handler);
        })
        .catch((err) => {
          WireProtocol.getPool().remove(handler);
          logger.error('Fetcher::downloadBodiesLoop, download failed error:', err);
          this.node.banPeer(handler.peer.peerId, err instanceof PeerRequestTimeoutError ? 'timeout' : 'error');
          return retry();
        });
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

  private async processBlockLoop() {
    for await (const { data: block } of this.blockQueue.generator()) {
      this.processParallel++;
      this.node
        .processBlock(block, false)
        .then(() => {
          this.processParallel--;
          if (this.processParallel < this.processLimit && this.processParallelResolve) {
            this.processParallelResolve();
            this.processParallelResolve = undefined;
            this.processParallelPromise = undefined;
          }

          if (block.header.number.eqn(this.bestHeight)) {
            this.abort();
          }
        })
        .catch((err) => {
          if (!this.abortFlag) {
            logger.error('Fetcher::processBlockLoop, process block error:', err);
            this.abort();
          }
        });
      if (this.processParallel >= this.processLimit && !this.processParallelPromise) {
        this.processParallelPromise = new Promise<void>((resolve) => {
          this.processParallelResolve = resolve;
        });
      }
    }
  }
}
