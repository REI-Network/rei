import { GXC2_ETHWIRE } from '@gxchain2/common/dist/constants';
import { Peer, PeerRequestTimeoutError } from '@gxchain2/network';
import { BlockHeader } from '@gxchain2/block';

import { Fetcher, Task, FetcherOptions } from './fetcher';

export type HeadersFethcerTaskData = { start: number; count: number };
export type HeadersFethcerTaskResult = BlockHeader[];
export type HeadersFethcerTask = Task<HeadersFethcerTaskData, HeadersFethcerTaskResult>;

export interface HeadersFetcherOptions extends FetcherOptions {
  timeoutBanTime?: number;
  errorBanTime?: number;
  bestHeight: number;
}

export declare interface HeadersFetcher {
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'result', listener: (task: HeadersFethcerTask) => void): this;

  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'result', listener: (task: HeadersFethcerTask) => void): this;
}

export class HeadersFetcher extends Fetcher<HeadersFethcerTaskData, HeadersFethcerTaskResult> {
  private readonly timeoutBanTime: number;
  private readonly errorBanTime: number;
  private readonly bestHeight: number;

  constructor(options: HeadersFetcherOptions) {
    super(options);
    this.bestHeight = options.bestHeight;
    this.timeoutBanTime = options.timeoutBanTime || 300000;
    this.errorBanTime = options.errorBanTime || 60000;
  }

  protected lockIdlePeer(peer: Peer) {
    peer.headersIdle = false;
  }

  protected findIdlePeer(): Peer | undefined {
    return this.node.peerpool.idle((peer) => this.isValidPeer(peer));
  }

  protected isValidPeer(peer: Peer): boolean {
    return peer.isSupport(GXC2_ETHWIRE) && peer.headersIdle;
  }

  protected async download(task: HeadersFethcerTask): Promise<{ retry?: HeadersFethcerTask[]; results?: HeadersFethcerTask[] }> {
    const peer = task.peer!;
    try {
      const headers: BlockHeader[] = await peer.getBlockHeaders(task.data.start, task.data.count);
      if (headers.length !== task.data.count) {
        throw new Error('invalid headers length');
      }
      // TODO: validate.
      return {
        results: [
          {
            data: task.data,
            result: headers,
            index: task.index
          }
        ]
      };
    } catch (err) {
      if (err instanceof PeerRequestTimeoutError) {
        this.node.peerpool.ban(peer, this.timeoutBanTime);
      } else {
        this.node.peerpool.ban(peer, this.errorBanTime);
      }
      this.abort();
      throw err;
    }
  }

  protected async process(task: HeadersFethcerTask): Promise<boolean> {
    this.emit('result', task);
    const result = task.result!;
    return result[result.length - 1].number.toNumber() === this.bestHeight;
  }
}
