import { BN } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { BlockHeader, Block, Transaction } from '@rei-network/structure';
import { PChannel, logger } from '@rei-network/utils';
import { WireProtocol, WireProtocolHandler } from '../../protocols';
import { LimitedConcurrency } from './limited';

const defaultDownloadBodiesLimit = 3;

export interface BlockSyncOptions {
  /**
   * How many block headers/bodies have been requested to download each time(default: 128)
   */
  maxGetBlockHeaders: BN;
  /**
   * How many remote handlers to download the block body at the same time(default: 3)
   */
  downloadBodiesLimit?: number;
  /**
   * Common instance used to construct the block
   */
  common: Common;
  /**
   * BlockSync backend used to process blocks
   */
  backend: BlockSyncBackend;
  /**
   * BlockSync validate backend used to validate block headers/bodies
   */
  validateBackend: BlockSyncValidateBackend;
}

export interface BlockSyncBackend {
  handlePeerError(prefix: string, peerId: string, err: any): Promise<void>;
  processAndCommitBlock(block: Block): Promise<boolean>;
}

export interface BlockSyncValidateBackend {
  validateHeaders(
    parent: BlockHeader | undefined,
    headers: BlockHeader[]
  ): BlockHeader;
  validateBodies(headers: BlockHeader[], bodies: Transaction[][]): void;
  validateBlocks(blocks): Promise<void>;
}

type ProcessBlocks = {
  blocks: Block[];
  resolve: () => void;
};

export class BlockSync {
  private readonly backend: BlockSyncBackend;
  private readonly validateBackend: BlockSyncValidateBackend;
  private readonly common: Common;
  private readonly maxGetBlockHeaders: BN;
  private readonly downloadBodiesLimit: number;

  private readonly useless = new Set<WireProtocolHandler>();

  protected processBlocksPromise?: Promise<{ reorged: boolean; error: any }>;
  private readonly processBlocksChannel = new PChannel<ProcessBlocks>({
    drop: ({ data: { resolve } }) => {
      // if the task has been dropped,
      // we immediately resolve the promise
      resolve();
    }
  });

  private aborted = false;
  private start!: BN;

  constructor(options: BlockSyncOptions) {
    this.backend = options.backend;
    this.validateBackend = options.validateBackend;
    this.common = options.common;
    this.maxGetBlockHeaders = options.maxGetBlockHeaders.clone();
    this.downloadBodiesLimit =
      options.downloadBodiesLimit ?? defaultDownloadBodiesLimit;
  }

  /**
   * Reset block syncer
   */
  reset() {
    this.aborted = false;
    this.processBlocksChannel.reset();
  }

  /**
   * Abort block syncer
   */
  private _abort() {
    this.aborted = true;
    this.processBlocksChannel.abort();
  }

  /**
   * Abort block syncer and wait until exit
   */
  async abort() {
    this._abort();
    this.processBlocksPromise && (await this.processBlocksPromise);
  }

  /**
   * Start fetch blocks from the target handler,
   * fetcher will only download headers from the target handler,
   * but download bodies from all connected handlers(choose one at random),
   * at the same time, block syncer will process all blocks sorted by block number
   * @param start - Start download number
   * @param totalCount - Number of download blocks
   * @param handler - Target handler
   * @returns Cumulative total difficulty of download headers and reorged
   */
  async fetch(start: BN, totalCount: BN, handler: WireProtocolHandler) {
    if (this.aborted) {
      throw new Error('aborted');
    }

    this.start = start.clone();
    // cumulativeTotalDifficulty records the total difficulty of the download headers
    const cumulativeTotalDifficulty = new BN(0);

    const downloadBodiesLimit = new LimitedConcurrency(
      this.downloadBodiesLimit
    );

    // start process blocks loop
    this.processBlocksPromise = this.processBlocksLoop();

    // start download headers
    await this.downloadHeaders(start, totalCount, handler, async (headers) => {
      // accumulate
      headers.forEach((header) => {
        cumulativeTotalDifficulty.iadd(header.difficulty);
      });
      // try to add download bodies task by headers
      await downloadBodiesLimit.newConcurrency(
        this.downloadBodies.bind(
          this,
          handler.protocol,
          headers,
          async (blocks) => {
            // try to add process blocks task by blocks
            // await processBlocksLimit.newConcurrency(this.processBlocks.bind(this, blocks));
            await this.processBlocks(blocks);
          }
        )
      );
    });

    // now, all headers have been downloaded and added to `downloadBodiesLimit`

    await downloadBodiesLimit.finished();

    // now, all bodies have been downloaded and processed

    // wait for the loop to exit and reset
    this.processBlocksChannel.abort();
    const { reorged, error } = await this.processBlocksPromise;
    this.processBlocksPromise = undefined;
    this.processBlocksChannel.reset();

    // put back useless handlers
    this.useless.forEach((h) => {
      handler.protocol.pool.put(h);
    });
    this.useless.clear();

    // handle errors, if an error occurs
    if (error) {
      await this.backend.handlePeerError(
        'BlockSync::fetch',
        handler.peer.peerId,
        error
      );
    }

    return {
      reorged,
      cumulativeTotalDifficulty
    };
  }

  private async downloadHeaders(
    start: BN,
    totalCount: BN,
    handler: WireProtocolHandler,
    onData: (headers: BlockHeader[]) => Promise<void>
  ) {
    const reserveTotalCount = totalCount.clone();
    const startNumber = start.clone();
    let parent: BlockHeader | undefined;
    while (!this.aborted && reserveTotalCount.gtn(0)) {
      let count: BN;
      if (reserveTotalCount.gt(this.maxGetBlockHeaders)) {
        count = this.maxGetBlockHeaders.clone();
      } else {
        count = reserveTotalCount.clone();
      }

      try {
        logger.info(
          'Download headers start:',
          startNumber.toString(),
          'count:',
          count.toString(),
          'from:',
          handler.peer.peerId
        );
        const headers = await handler.getBlockHeaders(startNumber, count);
        parent = this.validateBackend.validateHeaders(parent, headers);
        if (!count.eqn(headers.length)) {
          throw new Error('useless');
        }
        await onData(headers);
      } catch (err: any) {
        this._abort();
        if (err.message !== 'useless') {
          await this.backend.handlePeerError(
            'BlockSync::downloadHeaders',
            handler.peer.peerId,
            err
          );
        }
        return;
      }

      reserveTotalCount.isub(count);
      startNumber.iadd(count);
    }
  }

  private async downloadBodies(
    wire: WireProtocol,
    headers: BlockHeader[],
    onData: (blocks: Block[]) => Promise<void>
  ) {
    while (!this.aborted) {
      let handler: WireProtocolHandler;
      try {
        handler = await wire.pool.get();
      } catch (err) {
        this._abort();
        logger.warn('BlockSync::downloadBodies, get handler failed:', err);
        return;
      }

      try {
        logger.info(
          'Download bodies start:',
          headers[0].number.toNumber(),
          'count:',
          headers.length,
          'from:',
          handler.peer.peerId
        );
        const bodies = await handler.getBlockBodies(headers);
        this.validateBackend.validateBodies(headers, bodies);
        const blocks = headers.map((header, i) =>
          Block.fromBlockData(
            { header, transactions: bodies[i] },
            { common: this.common.copy(), hardforkByBlockNumber: true }
          )
        );
        await this.validateBackend.validateBlocks(blocks);
        wire.pool.put(handler);
        await onData(blocks);
        return;
      } catch (err: any) {
        this.useless.add(handler);
        if (err.message !== 'useless') {
          await this.backend.handlePeerError(
            'BlockSync::downloadBodies',
            handler.peer.peerId,
            err
          );
        }
      }
    }
  }

  private processBlocks(blocks: Block[]) {
    if (this.aborted || blocks.length === 0) {
      return Promise.resolve();
    }

    const first = blocks[0];
    const index = first.header.number
      .sub(this.start)
      .div(this.maxGetBlockHeaders)
      .toNumber();

    return new Promise<void>((resolve) => {
      this.processBlocksChannel.push({
        data: {
          blocks,
          resolve
        },
        index
      });
    });
  }

  private async processBlocksLoop(): Promise<{ reorged: boolean; error: any }> {
    let reorged = false;
    let error = undefined;
    for await (const {
      data: { blocks, resolve }
    } of this.processBlocksChannel) {
      try {
        for (const block of blocks) {
          reorged =
            (await this.backend.processAndCommitBlock(block)) || reorged;

          if (this.aborted) {
            resolve();
            return { reorged, error };
          }
        }
        resolve();
      } catch (err: any) {
        this._abort();
        resolve();

        /**
         * Do special handling for NotFoundError,
         * this error may be thrown when synchronously terminated
         */
        if (err.type !== 'NotFoundError') {
          error = err;
        }

        return { reorged, error };
      }
    }
    return { reorged, error };
  }
}
