import { EventEmitter } from 'events';

import { PriorityQueue, AsyncQueue, AysncChannel, AysncHeapChannel } from '@gxchain2/utils';
import { Peer, PeerRequestTimeoutError } from '@gxchain2/network';

import { Node } from '../../node';

export interface FetcherOptions<TData = any, TResult = any> {
  node: Node;
  protocol: string;
  limit?: number;
  timeoutBanTime?: number;
  errorBanTime?: number;

  download: (data: Task<TData>) => Promise<TResult>;
  process: (result: TResult) => Promise<boolean>;
}

type Task<TData = any> = {
  data: TData;
  peer?: Peer;
};

export class Fetcher<TData = any, TResult = any> extends EventEmitter {
  private readonly priorityQueue = new PriorityQueue<TResult>();
  private readonly limitQueue = new AsyncQueue<void>();
  private readonly taskQueue: AysncHeapChannel<{ task: Task<TData>; index: number }>;
  private readonly resultQueue: AysncChannel<TResult>;
  private readonly idlePeerQueue: AsyncQueue<Peer>;

  private readonly node: Node;
  private readonly limit: number;
  private readonly timeoutBanTime: number;
  private readonly errorBanTime: number;
  private readonly protocol: string;
  private readonly download: (data: Task<TData>) => Promise<TResult>;
  private readonly process: (result: TResult) => Promise<boolean>;
  private abortFlag: boolean = false;
  private fetchingPromise?: Promise<boolean>;

  constructor(options: FetcherOptions<TData, TResult>) {
    super();
    this.node = options.node;
    this.protocol = options.protocol;
    this.download = options.download;
    this.process = options.process;
    this.limit = options.limit || 16;
    this.timeoutBanTime = options.timeoutBanTime || 300000;
    this.errorBanTime = options.errorBanTime || 60000;

    this.priorityQueue.on('result', (result) => {
      if (!this.abortFlag) {
        this.resultQueue.push(result);
      }
    });
    this.taskQueue = new AysncHeapChannel<{ task: Task<TData>; index: number }>({
      compare: (a, b) => a.index < b.index,
      isAbort: () => this.abortFlag
    });
    this.resultQueue = new AysncChannel<TResult>({
      isAbort: () => this.abortFlag
    });
    this.idlePeerQueue = new AsyncQueue<Peer>({
      hasNext: () => {
        const peer = this.node.peerpool.idle(this.protocol);
        if (!peer) {
          return false;
        }
        this.idlePeerQueue.array.push(peer);
        return true;
      }
    });

    this.node.peerpool.on('idle', (peer) => {
      if (this.fetchingPromise && peer.idle && peer.latestHeight(this.protocol)) {
        this.idlePeerQueue.push(peer);
      }
    });
  }

  private async safelyDownload(task: Task<TData>): Promise<TResult> {
    const peer = task.peer!;
    try {
      const result = await this.download(task);
      peer.idle = true;
      return result;
    } catch (err) {
      if (err instanceof PeerRequestTimeoutError) {
        this.node.peerpool.ban(peer, this.timeoutBanTime);
      } else {
        this.node.peerpool.ban(peer, this.errorBanTime);
      }
      peer.idle = true;
      task.peer = undefined;
      throw err;
    }
  }

  /*
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
      task.peer = undefined;
      throw err;
    }
    */

  /*
    await this.node.processBlocks(result);
    if (result[result.length - 1].header.number.toNumber() === bestHeight) {
        this.taskOver();
    }
    */

  private taskOver() {
    this.limitQueue.abort();
    this.taskQueue.abort();
    this.taskQueue.clear();
    this.resultQueue.abort();
    this.resultQueue.clear();
    this.idlePeerQueue.abort();
    this.idlePeerQueue.clear();
    this.priorityQueue.reset();
  }

  async fetch(tasks: Task<TData>[]): Promise<boolean> {
    if (this.fetchingPromise) {
      throw new Error('fetcher is already fetching');
    }
    const fetchResult = await (this.fetchingPromise = new Promise<boolean>(async (fetchResolve) => {
      tasks.forEach((task, index) => this.taskQueue.push({ task, index }));
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

              const p = this.safelyDownload(task)
                .then((result) => {
                  this.priorityQueue.insert(result, index);
                })
                .catch(() => {
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
            this.taskOver();
            this.emit('error', err);
          } finally {
            resolve(result);
          }
        }),
        new Promise<boolean>(async (resolve) => {
          let result = false;
          try {
            for await (const result of this.resultQueue.generator()) {
              if (await this.process(result)) {
                this.taskOver();
              }
            }
            result = true;
          } catch (err) {
            this.taskOver();
            this.emit('error', err);
          } finally {
            resolve(result);
          }
        })
      ]);

      fetchResolve(results.reduce((a, b) => a && b, true));
    }));
    this.fetchingPromise = undefined;
    return fetchResult;
  }

  async abort() {
    if (this.fetchingPromise) {
      this.abortFlag = true;
      this.taskOver();
      await this.fetchingPromise;
    }
  }

  async reset() {
    await this.abort();
    this.abortFlag = false;
  }
}
