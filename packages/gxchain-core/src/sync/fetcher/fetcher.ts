import { EventEmitter } from 'events';

import { PriorityQueue, AsyncQueue, AysncChannel, AysncHeapChannel } from '@gxchain2/utils';
import { Peer } from '@gxchain2/network';

import { Node } from '../../node';

export interface FetcherOptions {
  node: Node;
  limit?: number;
}

export type Task<TData = any, TResult = any> = {
  data: TData;
  result?: TResult;
  index: number;
  peer?: Peer;
};

export declare interface Fetcher {
  on(event: 'error', listener: (error: Error) => void): this;

  once(event: 'error', listener: (error: Error) => void): this;
}

export class Fetcher<TData = any, TResult = any> extends EventEmitter {
  private readonly priorityQueue = new PriorityQueue<Task<TData, TResult>>();
  private readonly limitQueue = new AsyncQueue<void>();
  private readonly taskQueue: AysncHeapChannel<Task<TData, TResult>>;
  private readonly resultQueue: AysncChannel<Task<TData, TResult>>;
  private readonly idlePeerQueue: AsyncQueue<Peer>;

  protected readonly node: Node;
  protected abortFlag: boolean = false;
  private readonly limit: number;
  private fetchingPromise?: Promise<boolean>;

  constructor(options: FetcherOptions) {
    super();
    this.node = options.node;
    this.limit = options.limit || 16;

    this.priorityQueue.on('result', (result) => {
      if (!this.abortFlag) {
        this.resultQueue.push(result);
      }
    });
    this.taskQueue = new AysncHeapChannel<Task<TData, TResult>>({
      compare: (a, b) => a.index < b.index,
      isAbort: () => this.abortFlag
    });
    this.resultQueue = new AysncChannel<Task<TData, TResult>>({
      isAbort: () => this.abortFlag
    });
    this.idlePeerQueue = new AsyncQueue<Peer>({
      hasNext: () => {
        if (this.abortFlag) {
          this.idlePeerQueue.array.push(null);
          return true;
        }
        const peer = this.findIdlePeer();
        if (!peer) {
          return false;
        }
        this.idlePeerQueue.array.push(peer);
        return true;
      }
    });
  }

  private clearQueue() {
    this.taskQueue.clear();
    this.resultQueue.clear();
    this.idlePeerQueue.clear();
    this.priorityQueue.reset();
  }

  private taskOver() {
    this.clearQueue();
    this.limitQueue.abort();
    this.taskQueue.abort();
    this.resultQueue.abort();
    this.idlePeerQueue.abort();
  }

  insert(task: Task<TData>) {
    if (this.abortFlag) {
      throw new Error('fetcher is already aborted');
    }
    this.taskQueue.push(task);
  }

  async fetch(tasks?: Task<TData, TResult>[]): Promise<boolean> {
    if (this.fetchingPromise) {
      throw new Error('fetcher is already fetching');
    }
    this.clearQueue();
    const handleIdlePeer = (peer, type) => {
      if (this.fetchingPromise && !this.abortFlag && this.isValidPeer(peer, type)) {
        this.idlePeerQueue.push(peer);
      }
    };
    this.node.peerpool.on('idle', handleIdlePeer);
    const fetchResult = await (this.fetchingPromise = new Promise<boolean>(async (fetchResolve) => {
      if (tasks) {
        tasks.forEach((task) => this.taskQueue.push(task));
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
            let parallelLock: Promise<void> | undefined;
            for await (const task of this.taskQueue.generator()) {
              if (parallelLock) {
                await parallelLock;
                parallelLock = undefined;
              }

              const needLock = !!task.peer;
              if (!task.peer) {
                const peer = await this.idlePeerQueue.next();
                if (peer === null) {
                  break;
                }
                this.lockIdlePeer(peer);
                task.peer = peer;
              }

              const p = this.download(task)
                .then((downloadResult) => {
                  if (downloadResult.retry) {
                    downloadResult.retry.forEach((t) => this.insert(t));
                  }
                  if (downloadResult.results) {
                    downloadResult.results.forEach((t) => this.priorityQueue.insert(t));
                  }
                })
                .catch((err) => {
                  this.emit('error', err);
                })
                .finally(() => {
                  processOver(p);
                });
              if (needLock) {
                parallelLock = p;
              }
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
                break;
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

      fetchResolve(!this.abortFlag && results.reduce((a, b) => a && b, true));
    }));
    this.node.peerpool.removeListener('idle', handleIdlePeer);
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

  protected lockIdlePeer(peer: Peer) {
    throw new Error('Unimplemented');
  }
  protected findIdlePeer(): Peer | undefined {
    throw new Error('Unimplemented');
  }
  protected isValidPeer(peer: Peer, type: string): boolean {
    throw new Error('Unimplemented');
  }
  protected async download(data: Task<TData, TResult>): Promise<{ retry?: Task<TData, TResult>[]; results?: Task<TData, TResult>[] }> {
    throw new Error('Unimplemented');
  }
  protected async process(result: Task<TData, TResult>): Promise<boolean> {
    throw new Error('Unimplemented');
  }
}
