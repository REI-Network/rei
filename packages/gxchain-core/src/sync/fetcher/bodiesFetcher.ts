import { GXC2_ETHWIRE } from '@gxchain2/common/dist/constants';
import { Peer, PeerRequestTimeoutError } from '@gxchain2/network';
import { Block, BlockHeader } from '@gxchain2/block';
import { Transaction } from '@gxchain2/tx';

import { Fetcher, Task, FetcherOptions } from './fetcher';

export type BodiesFetcherTaskData = BlockHeader[] | undefined;
export type BodiesFetcherTaskResult = Block;
export type BodiesFetcherTask = Task<BodiesFetcherTaskData, BodiesFetcherTaskResult>;

export interface BodiesFetcherOptions extends FetcherOptions {
  timeoutBanTime?: number;
  errorBanTime?: number;
  localHeight: number;
  bestHeight: number;
}

export class BodiesFetcher extends Fetcher<BodiesFetcherTaskData, BodiesFetcherTaskResult> {
  private readonly timeoutBanTime: number;
  private readonly errorBanTime: number;
  private readonly localHeight: number;
  private readonly bestHeight: number;

  constructor(options: BodiesFetcherOptions) {
    super(options);
    this.localHeight = options.localHeight;
    this.bestHeight = options.bestHeight;
    this.timeoutBanTime = options.timeoutBanTime || 300000;
    this.errorBanTime = options.errorBanTime || 60000;
  }

  protected lockIdlePeer(peer: Peer) {
    peer.bodiesIdle = false;
  }

  protected findIdlePeer(): Peer | undefined {
    return this.node.peerpool.idle((peer) => peer.isSupport(GXC2_ETHWIRE) && peer.bodiesIdle);
  }

  protected isValidPeer(peer: Peer, type: string): boolean {
    return peer.isSupport(GXC2_ETHWIRE) && peer.bodiesIdle;
  }

  protected async download(task: BodiesFetcherTask): Promise<{ retry?: BodiesFetcherTask[]; results?: BodiesFetcherTask[] }> {
    const peer = task.peer!;
    try {
      const headers = task.data!;
      const bodies: Transaction[][] = await peer.getBlockBodies(headers);
      peer.bodiesIdle = true;
      if (bodies.length !== headers.length) {
        throw new Error('invalid block bodies length');
      }
      const retryHeaders: BodiesFetcherTaskData = [];
      const resultBlocks: Block[] = [];
      for (let i = 0; i < headers.length; i++) {
        try {
          const block = Block.fromBlockData(
            {
              header: headers[i],
              transactions: bodies[i]
            },
            { common: this.node.common }
          );
          await block.validateData();
          resultBlocks.push(block);
        } catch (err) {
          retryHeaders.push(headers[i]);
          this.emit('error', err);
        }
      }
      return Object.assign(
        retryHeaders.length > 0
          ? {
              retry: [
                {
                  data: retryHeaders,
                  index: retryHeaders[0].number.toNumber()
                }
              ]
            }
          : {},
        resultBlocks.length > 0
          ? {
              results: resultBlocks.map((b) => {
                return {
                  data: undefined,
                  result: b,
                  index: b.header.number.toNumber() - this.localHeight - 1
                };
              })
            }
          : {}
      );
    } catch (err) {
      if (err instanceof PeerRequestTimeoutError) {
        this.node.peerpool.ban(peer, this.timeoutBanTime);
      } else {
        this.node.peerpool.ban(peer, this.errorBanTime);
      }
      peer.bodiesIdle = true;
      task.peer = undefined;
      this.emit('error', err);
      return {
        retry: [task]
      };
    }
  }

  protected async process(task: BodiesFetcherTask): Promise<boolean> {
    try {
      const block = task.result!;
      await this.node.processBlock(block);
      return this.abortFlag || block.header.number.toNumber() === this.bestHeight;
    } catch (err) {
      this.emit('error', err);
      this.abort();
      return true;
    }
  }
}
