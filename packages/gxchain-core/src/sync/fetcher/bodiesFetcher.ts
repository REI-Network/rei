import { GXC2_ETHWIRE } from '@gxchain2/common/dist/constants';
import { Peer, PeerRequestTimeoutError } from '@gxchain2/network';
import { Block, BlockHeader } from '@gxchain2/block';
import { Transaction } from '@gxchain2/tx';

import { Fetcher, Task, FetcherOptions } from './fetcher';

export type BodiesFetcherTaskData = BlockHeader[];
export type BodiesFetcherTask = Task<BodiesFetcherTaskData, Transaction[][]>;

export interface BodiesFetcherOptions extends FetcherOptions {
  timeoutBanTime?: number;
  errorBanTime?: number;
  bestHeight: number;
}

export class BodiesFetcher extends Fetcher<BodiesFetcherTaskData, Transaction[][]> {
  private readonly timeoutBanTime: number;
  private readonly errorBanTime: number;
  private readonly bestHeight: number;

  constructor(options: BodiesFetcherOptions) {
    super(options);
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

  protected async download(task: BodiesFetcherTask): Promise<Transaction[][]> {
    const peer = task.peer!;
    try {
      const bodies: Transaction[][] = await peer.getBlockBodies(task.data);
      // TODO: validate.
      peer.bodiesIdle = true;
      return bodies;
    } catch (err) {
      if (err instanceof PeerRequestTimeoutError) {
        this.node.peerpool.ban(peer, this.timeoutBanTime);
      } else {
        this.node.peerpool.ban(peer, this.errorBanTime);
      }
      peer.bodiesIdle = true;
      task.peer = undefined;
      throw err;
    }
  }

  protected async process(task: BodiesFetcherTask): Promise<boolean> {
    const result = task.result!;
    const blocks = task.data.map((header, i) =>
      Block.fromBlockData(
        {
          header,
          transactions: result[i]
        },
        { common: this.node.common }
      )
    );
    try {
      await this.node.processBlocks(blocks);
      return blocks[blocks.length - 1].header.number.toNumber() === this.bestHeight;
    } catch (err) {
      this.emit('error', err);
      return true;
    }
  }
}
