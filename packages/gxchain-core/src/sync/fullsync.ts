import { OrderedQueue, AsyncQueue } from '@gxchain2/utils';
import { constants } from '@gxchain2/common';
import { Peer, PeerRequestTimeoutError } from '@gxchain2/network';
import { Block, BlockHeader } from '@gxchain2/block';

import { Synchronizer, SynchronizerOptions } from './sync';

export class NoIdlePeerError extends Error {}

export interface FullSynchronizerOptions extends SynchronizerOptions {
  limit?: number;
  count?: number;
  timeoutBanTime?: number;
  errorBanTime?: number;
}

type Task = {
  start: number;
  count: number;
};

export class FullSynchronizer extends Synchronizer {
  private readonly downloadQueue: OrderedQueue<Task>;
  private readonly resultQueue = new AsyncQueue<Block[] | null>();
  private readonly count: number;
  private readonly timeoutBanTime: number;
  private readonly errorBanTime: number;
  private abortFlag: boolean = false;

  constructor(options: FullSynchronizerOptions) {
    super(options);
    this.count = options.count || 128;
    this.timeoutBanTime = options.timeoutBanTime || 300000;
    this.errorBanTime = options.errorBanTime || 60000;
    this.downloadQueue = new OrderedQueue<Task, Block[]>({
      limit: options.limit || 16,
      processTask: this.download.bind(this)
    });
    this.downloadQueue.on('error', (queue, err) => this.emit('error', err));
    this.downloadQueue.on('result', (queue, data, result: any) => {
      this.resultQueue.push(result);
    });
    this.downloadQueue.on('over', (queue) => {
      this.stopProcessResult();
    });
    this.processResult();
  }

  private async download(task: Task) {
    const peer = this.node.peerpool.idle(constants.GXC2_ETHWIRE);
    if (!peer) {
      await new Promise((r) => setTimeout(r, this.interval));
      throw new NoIdlePeerError('can not find idle peer');
    }
    peer.idle = false;
    try {
      const headers: BlockHeader[] = await peer.getBlockHeaders(task.start, task.count);
      /*
      const bodies: any[] = await peer.request(
        constants.GXC2_ETHWIRE,
        'GetBlockBodies',
        headers.map((h) => h.hash())
      );
      const blocks = bodies.map(([txsData, unclesData], i: number) => Block.fromValuesArray([headers[i].raw(), txsData, unclesData], { common: this.node.common }));
      */
      const blocks = headers.map((h) =>
        Block.fromBlockData(
          {
            header: h
          },
          { common: this.node.common }
        )
      );
      peer.idle = true;
      return blocks;
    } catch (err) {
      peer.idle = true;
      if (err instanceof PeerRequestTimeoutError) {
        this.node.peerpool.ban(peer, this.timeoutBanTime);
      } else {
        this.node.peerpool.ban(peer, this.errorBanTime);
      }
      throw err;
    }
  }

  private async *makeAsyncGenerator() {
    while (!this.abortFlag) {
      const result = await this.resultQueue.next();
      if (result === null) {
        return;
      }
      yield result;
    }
  }

  private stopProcessResult() {
    this.resultQueue.push(null);
  }

  private async processResult() {
    for await (const result of this.makeAsyncGenerator()) {
      await this.node.processBlocks(result);
    }
  }

  async sync(): Promise<boolean> {
    let bestHeight = 0;
    const results = await Promise.all([
      new Promise<boolean>(async (resolve) => {
        let result = false;
        try {
          await this.downloadQueue.reset();
          const latestHeight = this.node.blockchain.latestHeight;
          bestHeight = latestHeight;
          let best: Peer | undefined;
          for (const peer of this.node.peerpool.peers) {
            const height = peer.latestHeight(constants.GXC2_ETHWIRE);
            if (height > bestHeight) {
              best = peer;
              bestHeight = height;
            }
          }
          if (best) {
            console.debug('start sync from:', best.peerId, 'best height:', bestHeight, 'local height:', latestHeight);
            let totalCount = bestHeight - latestHeight;
            let i = 0;
            while (totalCount > 0) {
              this.downloadQueue.insert({
                start: i * this.count + latestHeight + 1,
                count: totalCount > this.count ? this.count : totalCount
              });
              totalCount -= this.count;
              i++;
            }
            await this.downloadQueue.start();
            result = true;
          } else {
            this.stopProcessResult();
          }
        } catch (err) {
          this.emit('error', err);
        } finally {
          resolve(result);
        }
      }),
      new Promise<boolean>(async (resolve) => {
        let result = false;
        try {
          await this.processResult();
          result = true;
        } catch (err) {
          this.emit('error', err);
        } finally {
          resolve(result);
        }
      })
    ]);

    return results.reduce((a, b) => a && b, true) && bestHeight === this.node.blockchain.latestHeight;
  }

  async abort() {
    await this.downloadQueue.abort();
    await super.abort();
  }

  async reset() {
    await this.downloadQueue.reset();
    await super.reset();
  }
}
