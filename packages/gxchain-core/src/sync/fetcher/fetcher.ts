import { HChannel, PChannel, getRandomIntInclusive, logger } from '@gxchain2/utils';
import { BlockHeader, Block } from '@gxchain2/block';
import { emptyTxTrie } from '@gxchain2/tx';
import { Node } from '../../node';
import { Peer, PeerRequestTimeoutError } from '@gxchain2/network';
import { GXC2_ETHWIRE } from '@gxchain2/common/dist/constants';

export interface FetcherOptions {
  node: Node;
  count: number;
  limit: number;
  banPeer: (peer: Peer, reason: 'invalid' | 'timeout' | 'error') => void;
}

export class Fetcher {
  private abortFlag: boolean = false;
  private node: Node;
  private count: number;
  private banPeer: (peer: Peer, reason: 'invalid' | 'timeout' | 'error') => void;
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
  private idlePeerResolve?: (peer?: Peer) => void;

  constructor(options: FetcherOptions) {
    this.node = options.node;
    this.count = options.count;
    this.downloadLimit = options.limit;
    this.banPeer = options.banPeer;
    this.blockQueue = new PChannel<Block>({ aborter: options.node.aborter });
    this.downloadBodiesQueue = new HChannel<BlockHeader>({
      aborter: options.node.aborter,
      compare: (a, b) => a.number.lt(b.number)
    });
  }

  /**
   * Fetch blocks from specified peer
   * @param start - start height of block
   * @param count - the number of blocks to fetch
   * @param peerId - the id of peer
   */
  async fetch(start: number, count: number, peerId: string) {
    this.bestHeight = start + count;
    this.localHeight = start;
    await Promise.all([this.downloadHeader(start, count, peerId), this.downloadBodiesLoop(), this.processBlockLoop()]);
  }

  reset() {
    this.abortFlag = false;
    this.downloadBodiesQueue.reset();
    this.blockQueue.reset();
  }

  abort() {
    logger.debug('Fetcher::abort');
    this.abortFlag = true;
    if (this.idlePeerResolve) {
      this.idlePeerResolve(undefined);
    }
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

  private async downloadHeader(start: number, count: number, peerId: string) {
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
      const peer = this.node.peerpool.getPeer(peerId);
      if (!peer) {
        this.abort();
        return;
      }
      try {
        const headers: BlockHeader[] = await peer.getBlockHeaders(start, count);
        if (headers.length !== count) {
          logger.warn('Fetcher::downloadHeader, invalid header(length)');
          this.abort();
          this.banPeer(peer, 'invalid');
          return;
        }
        for (let index = 1; i < headers.length; i++) {
          if (!headers[index - 1].hash().equals(headers[index].parentHash)) {
            logger.warn('Fetcher::downloadHeader, invalid header(parentHash)');
            this.abort();
            this.banPeer(peer, 'invalid');
            return;
          }
        }
        logger.info('Download headers start:', start, 'count:', count, 'from:', peer.peerId);
        for (const header of headers) {
          this.downloadBodiesQueue.push(header);
        }
      } catch (err) {
        logger.error('Fetcher::downloadHeader, catch error:', err);
        this.abort();
        this.banPeer(peer, err instanceof PeerRequestTimeoutError ? 'timeout' : 'error');
        return;
      }
      if (this.processParallelPromise) {
        await this.processParallelPromise;
      }
    }
  }

  private findIdlePeer(uselessPeer: Set<string>, height: number) {
    const peers = this.node.peerpool.peers.filter((p) => p.bodiesIdle && p.isSupport(GXC2_ETHWIRE) && p.getStatus(GXC2_ETHWIRE).height >= height && !uselessPeer.has(p.peerId));
    let peer: Peer | undefined;
    if (peers.length === 1) {
      peer = peers[0];
    } else if (peers.length > 0) {
      peer = peers[getRandomIntInclusive(0, peers.length - 1)];
    }
    return peer;
  }

  private async downloadBodiesLoop() {
    const uselessPeer = new Set<string>();
    let headersCache: BlockHeader[] = [];
    for await (const header of this.downloadBodiesQueue.generator()) {
      headersCache.push(header);
      if (headersCache.length < this.count && this.downloadBodiesQueue.heap.length > 0) {
        continue;
      }
      const headers = [...headersCache];
      headersCache = [];

      let peer = this.findIdlePeer(uselessPeer, headers[headers.length - 1].number.toNumber());
      if (!peer) {
        // set timeout for find idle peer.
        const timeout = setTimeout(() => {
          if (this.idlePeerResolve) {
            logger.debug('Fetcher, find peer timeout!');
            this.idlePeerResolve();
          } else {
            logger.debug("Fetcher, find peer timeout, but can't resolve!");
          }
        }, 3000);
        peer = await new Promise<Peer | undefined>((resolve) => {
          this.idlePeerResolve = resolve;
          this.node.peerpool.on('idle', () => {
            const newPeer = this.findIdlePeer(uselessPeer, headers[headers.length - 1].number.toNumber());
            if (newPeer) {
              resolve(newPeer);
            }
          });
        });
        clearTimeout(timeout);
        this.idlePeerResolve = undefined;
        this.node.peerpool.removeAllListeners('idle');
        if (peer === undefined) {
          this.abort();
          continue;
        }
        if (this.abortFlag) {
          continue;
        }
      }
      peer.bodiesIdle = false;

      const retry = () => {
        if (!this.abortFlag) {
          for (const header of headers) {
            this.downloadBodiesQueue.push(header);
          }
        }
      };
      this.downloadParallel++;
      peer
        .getBlockBodies(headers)
        .then(async (bodies) => {
          this.downloadParallel--;
          if (this.downloadParallelResolve) {
            this.downloadParallelResolve();
            this.downloadParallelResolve = undefined;
          }

          if (bodies.length !== headers.length) {
            logger.warn('Fetcher::downloadBodiesLoop, invalid bodies(length)');
            this.banPeer(peer!, 'invalid');
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
                uselessPeer.add(peer!.peerId);
                logger.debug('Fetcher, ', peer!.peerId, 'add to useless peer');
                peer!.bodiesIdle = true;
                return retry();
              }
              await block.validateData();
              blocks.push(block);
            } catch (err) {
              logger.warn('Fetcher::downloadBodiesLoop, invalid bodies(validateData)', err);
              this.banPeer(peer!, 'invalid');
              return retry();
            }
          }
          logger.info('Download bodies start:', headers[0].number.toNumber(), 'count:', headers.length, 'from:', peer!.peerId);
          if (!this.abortFlag) {
            for (const block of blocks) {
              this.blockQueue.push({ data: block, index: block.header.number.toNumber() - this.localHeight - 1 });
            }
          }
          peer!.bodiesIdle = true;
        })
        .catch((err) => {
          peer!.bodiesIdle = true;
          logger.error('Fetcher::downloadBodiesLoop, download failed error:', err);
          this.banPeer(peer!, err instanceof PeerRequestTimeoutError ? 'timeout' : 'error');
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
