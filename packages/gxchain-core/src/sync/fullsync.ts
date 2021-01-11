import { PriorityQueue, AsyncQueue, AysncChannel, AysncHeapChannel } from '@gxchain2/utils';
import { constants } from '@gxchain2/common';
import { Peer, PeerRequestTimeoutError } from '@gxchain2/network';
import { Block, BlockHeader } from '@gxchain2/block';
import { Transaction } from '@gxchain2/tx';

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
  peer?: Peer;
};

export class FullSynchronizer extends Synchronizer {
  private readonly priorityQueue = new PriorityQueue<Block[]>();
  private readonly limitQueue = new AsyncQueue<void>();
  private readonly taskQueue: AysncHeapChannel<{ task: Task; index: number }>;
  private readonly resultQueue: AysncChannel<Block[]>;
  private readonly idlePeerQueue: AsyncQueue<Peer>;

  private readonly limit: number;
  private readonly count: number;
  private readonly timeoutBanTime: number;
  private readonly errorBanTime: number;
  private abortFlag: boolean = false;
  private isSyncing: boolean = false;

  constructor(options: FullSynchronizerOptions) {
    super(options);
    this.limit = options.limit || 16;
    this.count = options.count || 128;
    this.timeoutBanTime = options.timeoutBanTime || 300000;
    this.errorBanTime = options.errorBanTime || 60000;

    this.priorityQueue.on('result', (result) => {
      if (!this.abortFlag) {
        this.resultQueue.push(result);
      }
    });
    this.taskQueue = new AysncHeapChannel<{ task: Task; index: number }>({
      compare: (a, b) => a.index < b.index,
      isAbort: () => this.abortFlag
    });
    this.resultQueue = new AysncChannel<Block[]>({
      isAbort: () => this.abortFlag
    });
    this.idlePeerQueue = new AsyncQueue<Peer>({
      hasNext: () => {
        const peer = this.node.peerpool.idle(constants.GXC2_ETHWIRE);
        if (!peer) {
          return false;
        }
        this.idlePeerQueue.array.push(peer);
        return true;
      }
    });

    this.node.peerpool.on('idle', (peer) => {
      if (this.isSyncing && peer.idle && peer.latestHeight(constants.GXC2_ETHWIRE)) {
        this.idlePeerQueue.push(peer);
      }
    });
  }

  private async download(task: Task): Promise<Block[]> {
    const peer = task.peer!;
    try {
      const headers: BlockHeader[] = await peer.getBlockHeaders(task.start, task.count);
      const bodies: Transaction[][] = await peer.request(constants.GXC2_ETHWIRE, 'GetBlockBodies', headers);
      const blocks = bodies.map((transactions, i: number) =>
        Block.fromBlockData(
          {
            header: headers[i],
            transactions
          },
          { common: this.node.common }
        )
      );
      peer.idle = true;
      return blocks;
    } catch (err) {
      if (err instanceof PeerRequestTimeoutError) {
        this.node.peerpool.ban(peer, this.timeoutBanTime);
      } else {
        this.node.peerpool.ban(peer, this.errorBanTime);
      }
      peer.idle = true;
      throw err;
    }
  }

  private taskOver() {
    this.limitQueue.abort();
    this.taskQueue.abort();
    this.resultQueue.abort();
    this.idlePeerQueue.abort();
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

    if (this.isSyncing) {
      throw new Error('FullSynchronizer already sync');
    }
    this.isSyncing = true;

    console.debug('get best height from:', best!.peerId, 'best height:', bestHeight, 'local height:', latestHeight);
    let totalCount = bestHeight - latestHeight;
    let totalTaskCount = 0;
    while (totalCount > 0) {
      this.taskQueue.push({
        task: {
          start: totalTaskCount * this.count + latestHeight + 1,
          count: totalCount > this.count ? this.count : totalCount
        },
        index: totalTaskCount
      });
      totalTaskCount++;
      totalCount -= this.count;
    }

    const results = await Promise.all([
      new Promise<boolean>(async (resolve) => {
        let result = false;
        try {
          const promiseArray: Promise<void>[] = [];
          const processOver = (p: Promise<void>) => {
            const index = promiseArray.indexOf(p);
            if (index !== -1) {
              promiseArray.splice(index, 1);
              this.limitQueue.push();
            }
          };
          const makePromise = () => {
            return promiseArray.length < this.limit ? Promise.resolve() : this.limitQueue.next();
          };
          for await (const { task, index } of this.taskQueue.generator()) {
            if (!task.peer) {
              const peer = await this.idlePeerQueue.next();
              if (peer === null) {
                break;
              }
              peer.idle = false;
              task.peer = peer;
            }

            const p = this.download(task)
              .then((result) => {
                this.priorityQueue.insert(result, index);
              })
              .catch((err) => {
                this.taskQueue.push({ task, index });
              })
              .finally(() => {
                processOver(p);
              });
            promiseArray.push(p);
            await makePromise();
          }
          await Promise.all(promiseArray);
          result = true;
        } catch (err) {
          this.emit('error', err);
        } finally {
          this.resultQueue.abort();
          resolve(result);
        }
      }),
      new Promise<boolean>(async (resolve) => {
        let result = false;
        try {
          for await (const result of this.resultQueue.generator()) {
            await this.node.processBlocks(result);
            if (result[result.length - 1].header.number.toNumber() === bestHeight) {
              this.taskOver();
            }
          }
          result = true;
        } catch (err) {
          this.emit('error', err);
        } finally {
          resolve(result);
        }
      })
    ]);

    this.isSyncing = false;
    return results.reduce((a, b) => a && b, true) && bestHeight === this.node.blockchain.latestHeight;
  }

  async abort() {
    this.taskQueue.abort();
    this.taskQueue.clear();
    this.idlePeerQueue.abort();
    this.idlePeerQueue.clear();
    await super.abort();
  }

  async reset() {
    await super.reset();
  }
}
