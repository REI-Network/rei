import { OrderedQueue, AysncChannel } from '@gxchain2/utils';
import { constants } from '@gxchain2/common';
import { Peer, PeerRequestTimeoutError } from '@gxchain2/network';
import { Block, BlockHeader } from '@gxchain2/block';

import { Synchronizer, SynchronizerOptions } from './sync';

export interface FullSynchronizerOptions extends SynchronizerOptions {
  limit?: number;
  count?: number;
  timeoutBanTime?: number;
  errorBanTime?: number;
}

type Task = {
  start: number;
  count: number;
  peer: Peer;
};

export class FullSynchronizer extends Synchronizer {
  private readonly downloadQueue: OrderedQueue<Task>;
  private readonly resultQueue: AysncChannel<Block[]>;
  private readonly idlePeerQueue: AysncChannel<Peer>;
  private readonly count: number;
  private readonly timeoutBanTime: number;
  private readonly errorBanTime: number;
  private abortFlag: boolean = false;

  constructor(options: FullSynchronizerOptions) {
    super(options);
    this.count = options.count || 128;
    this.timeoutBanTime = options.timeoutBanTime || 300000;
    this.errorBanTime = options.errorBanTime || 60000;
    this.resultQueue = new AysncChannel<Block[]>({
      isAbort: () => this.abortFlag
    });
    this.idlePeerQueue = new AysncChannel<Peer>({
      hasNext: () => {
        const peer = this.node.peerpool.idle(constants.GXC2_ETHWIRE);
        if (!peer) {
          return false;
        }
        peer.idle = false;
        this.idlePeerQueue.array.push(peer);
        return true;
      },
      isAbort: () => this.abortFlag
    });
    this.downloadQueue = new OrderedQueue<Task, Block[]>({
      limit: options.limit || 16,
      processTask: this.download.bind(this)
    });
    this.downloadQueue.on('error', (queue, err) => this.emit('error', err));
    this.downloadQueue.on('result', (queue, data, result: any) => {
      this.resultQueue.push(result);
    });
    this.downloadQueue.on('over', (queue) => {
      this.resultQueue.abort();
    });
  }

  private async download(task: Task) {
    const peer = task.peer;
    if (peer.idle) {
      throw new Error('FullSynchronizer, invalid idle peer');
    }
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

  async sync(): Promise<boolean> {
    let bestHeight = 0;
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
    if (!best) {
      return false;
    }

    // handle idle event.
    const onPeelIdle = (peer: Peer) => {
      if (peer.idle && peer.latestHeight(constants.GXC2_ETHWIRE)) {
        this.idlePeerQueue.push(peer);
      }
    };
    this.node.peerpool.on('idle', onPeelIdle);

    console.debug('start sync from:', best!.peerId, 'best height:', bestHeight, 'local height:', latestHeight);
    let totalCount = bestHeight - latestHeight;
    const totalTaskCount = Math.ceil(totalCount / this.count);

    await this.downloadQueue.reset();
    const results = await Promise.all([
      new Promise<boolean>(async (resolve) => {
        let result = false;
        try {
          let i = 0;
          for await (const peer of this.idlePeerQueue.generator()) {
            this.downloadQueue.insert({
              peer,
              start: i++ * this.count + latestHeight + 1,
              count: totalCount > this.count ? this.count : totalCount
            });
            totalCount -= this.count;
            if (totalCount <= 0) {
              break;
            }
          }
          result = true;
        } catch (err) {
          this.emit('error', err);
        } finally {
          resolve(result);
        }
      }),
      new Promise<boolean>(async (resolve) => {
        let result = false;
        try {
          await this.downloadQueue.start(totalTaskCount);
          result = true;
        } catch (err) {
          this.emit('error', err);
        } finally {
          resolve(result);
        }
      }),
      new Promise<boolean>(async (resolve) => {
        let result = false;
        try {
          for await (const result of this.resultQueue.generator()) {
            await this.node.processBlocks(result);
          }
          result = true;
        } catch (err) {
          this.emit('error', err);
        } finally {
          resolve(result);
        }
      })
    ]);

    // remove idle event listener.
    this.node.peerpool.removeListener('idle', onPeelIdle);

    return results.reduce((a, b) => a && b, true) && bestHeight === this.node.blockchain.latestHeight;
  }

  async abort() {
    this.idlePeerQueue.abort();
    for (const peer of this.idlePeerQueue.array) {
      if (peer) {
        peer.idle = true;
      }
    }
    this.idlePeerQueue.clear();
    await this.downloadQueue.abort();
    await super.abort();
  }

  async reset() {
    await this.downloadQueue.reset();
    await super.reset();
  }
}
