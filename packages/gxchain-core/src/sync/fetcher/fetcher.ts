import { HChannel, Channel, PriorityQueue, getRandomIntInclusive, logger } from '@gxchain2/utils';
import { BlockHeader, Block } from '@gxchain2/block';
import { Node } from '../../node';
import { Peer, PeerRequestTimeoutError } from '@gxchain2/network';
import { GXC2_ETHWIRE } from '@gxchain2/common/dist/constants';
import { EventEmitter } from 'events';

export interface FetcherOptions {
  node: Node;
  count: number;
  limit: number;
  banPeer: (peer: Peer, reason: 'invalid' | 'timeout' | 'error') => void;
}

export class Fetcher extends EventEmitter {
  private abortFlag: boolean = false;
  private node: Node;
  private count: number;
  private limit: number;
  private banPeer: (peer: Peer, reason: 'invalid' | 'timeout' | 'error') => void;
  private parallel: number = 0;
  private parallelResolve?: () => void;
  private localHeight!: number;
  private bestHeight!: number;
  private headerTaskOver = false;
  private priorityQueue = new PriorityQueue<Block>();
  private blocksQueue: Channel<Block>;
  private downloadBodiesQueue: HChannel<BlockHeader>;
  private idlePeerResolve?: (peer?: Peer) => void;

  constructor(options: FetcherOptions) {
    super();
    this.node = options.node;
    this.count = options.count;
    this.limit = options.limit;
    this.banPeer = options.banPeer;
    this.blocksQueue = new Channel<Block>({ aborter: options.node.aborter });
    this.downloadBodiesQueue = new HChannel<BlockHeader>({
      aborter: options.node.aborter,
      compare: (a, b) => a.number.lt(b.number)
    });
    this.priorityQueue.on('result', (block) => {
      if (!this.abortFlag) {
        this.emit('newBlock', block);
        if (block.header.number.eqn(this.bestHeight)) {
          this.stopFetch();
        }
      }
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
    await Promise.all([this.downloadHeader(start, count, peerId), this.downloadBodiesLoop()]);
  }

  abort() {
    this.stopFetch();
  }

  private stopFetch() {
    this.abortFlag = true;
    if (this.idlePeerResolve) {
      this.idlePeerResolve(undefined);
    }
    this.priorityQueue.reset();
    this.downloadBodiesQueue.abort();
    this.blocksQueue.abort();
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
        this.stopFetch();
        return;
      }
      try {
        const headers: BlockHeader[] = await peer.getBlockHeaders(start, count);
        if (headers.length !== count) {
          logger.warn('Fetcher::downloadHeader, invalid header(length)');
          this.stopFetch();
          this.banPeer(peer, 'invalid');
          return;
        }
        for (let index = 1; i < headers.length; i++) {
          if (!headers[index - 1].hash().equals(headers[index].parentHash)) {
            logger.warn('Fetcher::downloadHeader, invalid header(parentHash)');
            this.stopFetch();
            this.banPeer(peer, 'invalid');
            return;
          }
        }
        for (const header of headers) {
          this.downloadBodiesQueue.push(header);
        }
      } catch (err) {
        logger.error('Fetcher::downloadHeader, catch error:', err);
        this.stopFetch();
        this.banPeer(peer, err instanceof PeerRequestTimeoutError ? 'timeout' : 'error');
        return;
      }
    }
    this.headerTaskOver = true;
  }

  private findIdlePeer(height: number) {
    const peers = this.node.peerpool.peers.filter((p) => p.bodiesIdle && p.isSupport(GXC2_ETHWIRE) && p.getStatus(GXC2_ETHWIRE).height >= height);
    let peer: Peer | undefined;
    if (peers.length === 1) {
      peer = peers[0];
    } else if (peers.length > 0) {
      peer = peers[getRandomIntInclusive(0, peers.length - 1)];
    }
    return peer;
  }

  private async downloadBodiesLoop() {
    let headersCache: BlockHeader[] = [];
    for await (const header of this.downloadBodiesQueue.generator()) {
      headersCache.push(header);
      if (!this.headerTaskOver && headersCache.length < this.count) {
        continue;
      }
      const headers = [...headersCache];
      headersCache = [];

      let peer = this.findIdlePeer(headers[headers.length - 1].number.toNumber());
      if (!peer) {
        peer = await new Promise<Peer | undefined>((resolve) => {
          this.idlePeerResolve = resolve;
          this.node.peerpool.on('idle', () => {
            const newPeer = this.findIdlePeer(headers[headers.length - 1].number.toNumber());
            if (newPeer) {
              resolve(newPeer);
            }
          });
        });
        this.idlePeerResolve = undefined;
        this.node.peerpool.removeAllListeners('idle');
        if (this.abortFlag || peer === undefined) {
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
      this.parallel++;
      peer
        .getBlockBodies(headers)
        .then(async (bodies) => {
          this.parallel--;
          if (this.parallelResolve) {
            this.parallelResolve();
            this.parallelResolve = undefined;
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
              const block = Block.fromBlockData({ header, transactions }, { common: this.node.getCommon(header.number) });
              await block.validateData();
              blocks.push(block);
            } catch (err) {
              logger.warn('Fetcher::downloadBodiesLoop, invalid bodies(validateData)');
              this.banPeer(peer!, 'invalid');
              return retry();
            }
          }
          if (!this.abortFlag) {
            for (const block of blocks) {
              this.priorityQueue.insert(block, block.header.number.toNumber() - this.localHeight - 1);
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
      if (this.parallel >= this.limit) {
        await new Promise<void>((resolve) => {
          this.parallelResolve = resolve;
        });
      }
    }
  }
}
