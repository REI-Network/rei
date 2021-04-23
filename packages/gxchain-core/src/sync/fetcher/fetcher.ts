import { AsyncHeapChannel, PriorityQueue, getRandomIntInclusive, AsyncChannel, logger } from '@gxchain2/utils';
import { BlockHeader, Block } from '@gxchain2/block';
import { Node } from '../../node';
import { Peer } from '@gxchain2/network';
import { GXC2_ETHWIRE } from '@gxchain2/common/dist/constants';
import { EventEmitter } from 'events';

export interface FetcherOptions {
  node: Node;
  limitCount: number;
}

export class Fetcher extends EventEmitter {
  private abortFlag: boolean = false;
  private node: Node;
  private limitCount: number;
  private localHeight!: number;
  private bestHeight!: number;
  private headerTaskOver = false;
  private priorityQueue = new PriorityQueue<Block>();
  private blocksQueue = new AsyncChannel<Block>({ isAbort: () => this.abortFlag });
  private downloadBodiesQueue = new AsyncHeapChannel<BlockHeader>({
    isAbort: () => this.abortFlag,
    compare: (a, b) => a.number.lt(b.number)
  });
  private idlePeerResolve?: (peer?: Peer) => void;

  constructor(options: FetcherOptions) {
    super();
    this.node = options.node;
    this.limitCount = options.limitCount;
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
        start: i * this.limitCount + start + 1,
        count: count > this.limitCount ? this.limitCount : count
      });
      i++;
      count -= this.limitCount;
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
          return;
        }
        for (let index = 1; i < headers.length; i++) {
          if (!headers[index - 1].hash().equals(headers[index].parentHash)) {
            logger.warn('Fetcher::downloadHeader, invalid header(parentHash)');
            this.stopFetch();
            return;
          }
        }
        for (const header of headers) {
          this.downloadBodiesQueue.push(header);
        }
      } catch (err) {
        logger.error('Fetcher::downloadHeader, catch error:', err);
        this.stopFetch();
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
      if (!this.headerTaskOver && headersCache.length < this.limitCount) {
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
        this.node.peerpool.ban(peer!);
      };
      peer
        .getBlockBodies(headers)
        .then(async (bodies) => {
          peer!.bodiesIdle = true;
          if (bodies.length !== headers.length) {
            logger.warn('Fetcher::downloadBodiesLoop, invalid bodies(length)');
            return retry();
          }
          const blocks: Block[] = [];
          for (let i = 0; i < bodies.length; i++) {
            try {
              const transactions = bodies[i];
              const header = headers[i];
              const block = Block.fromBlockData({ header, transactions }, { common: this.node.common });
              await block.validateData();
              blocks.push(block);
            } catch (err) {
              logger.warn('Fetcher::downloadBodiesLoop, invalid bodies(validateData)');
              return retry();
            }
          }
          if (!this.abortFlag) {
            for (const block of blocks) {
              this.priorityQueue.insert(block, block.header.number.toNumber() - this.localHeight - 1);
            }
          }
        })
        .catch((err) => {
          peer!.bodiesIdle = true;
          logger.error('Fetcher::downloadBodiesLoop, download failed error:', err);
          return retry();
        });
    }
  }
}
