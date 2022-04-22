import { BN, BNLike } from 'ethereumjs-util';
import { Channel, getRandomIntInclusive, logger, AbortableTimer } from '@rei-network/utils';
import { Block, Receipt } from '@rei-network/structure';
import { Common } from '@rei-network/common';
import { preValidateBlock } from '../validation';
import { WireProtocolHandler, HandlerPool } from '../protocols';

const maxSnapSyncLimit = 200;
const minSnapSyncInterval = 100000;
const confirmLimit = 3;
const confirmTimeout = 3000;
const unconfirmLimit = 3;

type SyncContext = {
  td: BN;
  start: BN;
  height: BN;
  block: Block;
  receipts: Receipt[];

  isSnapSync: boolean;
};

type ConfirmContext = {
  td: BN;
  height: BN;
  block: Block;
  receipts: Receipt[];

  serializedHeader: Buffer;
  serializedReceipts: Buffer[];

  confirmed: Set<string>;
  unconfirmed: Set<string>;

  timeout: NodeJS.Timeout;
};

enum ConfirmStatus {
  WaitingForConfirm,
  Confirmed,
  Unconfirmed
}

export type Announcement = {
  handler: WireProtocolHandler;
  block?: Block;
};

export interface ISnapSync {
  setRoot(root: Buffer): Promise<void>;
  start(): void;
  abort(): Promise<void>;
  finished: boolean;
}

export interface IFullSync {
  setTarget(handler: WireProtocolHandler): Promise<boolean>;
  abort(): Promise<void>;
  finished: boolean;
}

export interface SyncBackend {
  getCommon(num: BNLike): Common;
  getHeight(): BN;
  getTotalDifficulty(): BN;
}

export interface SyncOptions {
  backend: SyncBackend;
  pool: HandlerPool<WireProtocolHandler>;
  snapSync: ISnapSync;
  fullSync: IFullSync;
  enableRandomPick: boolean;
  validate: boolean;
}

export class Sync {
  readonly backend: SyncBackend;
  readonly pool: HandlerPool<WireProtocolHandler>;
  readonly snapSync: ISnapSync;
  readonly fullSync: IFullSync;
  readonly enableRandomPick: boolean;
  readonly validate: boolean;

  syncContext?: SyncContext;
  confirmContext?: ConfirmContext;

  private readonly channel = new Channel<Announcement>();

  private aborted: boolean = false;
  private isWorking: boolean = false;
  private timer = new AbortableTimer();

  private syncPromise?: Promise<void>;
  private randomPickPromise?: Promise<void>;

  constructor(options: SyncOptions) {
    this.backend = options.backend;
    this.pool = options.pool;
    this.snapSync = options.snapSync;
    this.fullSync = options.fullSync;
    this.enableRandomPick = options.enableRandomPick;
    this.validate = options.validate;
  }

  get isSyncing() {
    this.clearFinishedSync();
    return !!this.syncContext;
  }

  private resetConfirmContext(ctx?: ConfirmContext) {
    this.confirmContext && clearTimeout(this.confirmContext.timeout);
    this.confirmContext = ctx;
  }

  private async resetSyncContext() {
    if (this.syncContext) {
      if (this.syncContext.isSnapSync) {
        await this.snapSync.abort();
      } else {
        await this.fullSync.abort();
      }
      this.syncContext = undefined;
    }
  }

  private clearFinishedSync() {
    if (this.syncContext) {
      const { isSnapSync } = this.syncContext;
      if (isSnapSync && this.snapSync.finished) {
        this.syncContext = undefined;
      } else if (!isSnapSync && this.fullSync.finished) {
        this.syncContext = undefined;
      }
    }
  }

  private async syncLoop() {
    for await (const ann of this.channel) {
      try {
        this.isWorking = true;

        const handler = ann.handler;
        const status = handler.status!;
        const peerId = handler.peer.peerId;
        const height = new BN(status.height);
        const td = new BN(status.totalDifficulty);

        let block = ann.block;
        let receipts: Receipt[] | undefined;
        const downloadDataFromPeer = async () => {
          if (block && receipts) {
            return { block, receipts };
          }

          const result = await this.downloadDataFromPeer(height, handler);
          if (result === null) {
            throw new Error('download data from: ' + peerId + ' failed');
          }

          block = result.block;
          receipts = result.receipts;
          return { block, receipts };
        };

        const resetConfirmContextToCurrent = async () => {
          const { block, receipts } = await downloadDataFromPeer();

          const ctx: ConfirmContext = {
            td,
            height,
            block,
            receipts,
            serializedHeader: block.header.serialize(),
            serializedReceipts: receipts.map((r) => r.serialize()),
            confirmed: new Set<string>([peerId]),
            unconfirmed: new Set<string>(),
            timeout: setTimeout(() => {
              if (this.confirmContext === ctx) {
                this.resetConfirmContext();
              }
            }, confirmTimeout)
          };

          this.resetConfirmContext(ctx);
          await this.collectConfirm(ctx);
        };

        this.clearFinishedSync();

        if (this.confirmContext) {
          const { td: confirmTD, confirmed, unconfirmed } = this.confirmContext;
          if (confirmTD.lte(this.backend.getTotalDifficulty())) {
            this.resetConfirmContext();
          } else if (td.gte(confirmTD) && !confirmed.has(peerId) && !unconfirmed.has(peerId)) {
            const { block, receipts } = await downloadDataFromPeer();
            const status = await this.updateConfirmContext(handler, this.confirmContext, block, receipts, peerId);
            if (status === ConfirmStatus.Confirmed || status === ConfirmStatus.WaitingForConfirm) {
              continue;
            }
          }
        }

        if (this.syncContext) {
          const { isSnapSync, height: syncHeight } = this.syncContext;
          if (isSnapSync) {
            if (!this.confirmContext) {
              if (height.sub(syncHeight).gten(maxSnapSyncLimit)) {
                await resetConfirmContextToCurrent();
              }
            } else {
              const confirmHeight = this.confirmContext.height;
              if (height.sub(confirmHeight).gten(maxSnapSyncLimit)) {
                await resetConfirmContextToCurrent();
              }
            }
          }
        }

        if (!this.syncContext && !this.confirmContext) {
          if (td.gt(this.backend.getTotalDifficulty())) {
            await resetConfirmContextToCurrent();
          }
        }
      } catch (err) {
        logger.warn('Sync::syncLoop, catch:', err);
      } finally {
        this.isWorking = false;
      }
    }
  }

  private async randomPickLoop() {
    while (!this.aborted) {
      await this.timer.wait(1000);
      if (this.aborted) {
        break;
      }

      this.pickRandomPeerToSync();
    }
  }

  private pickRandomPeerToSync() {
    if (!this.isWorking && this.channel.array.length === 0) {
      const td = this.backend.getTotalDifficulty();
      const handlers = this.pool.handlers.filter((handler) => new BN(handler.status!.totalDifficulty).gt(td));
      if (handlers.length === 0) {
        return;
      }

      this.channel.push({ handler: handlers[getRandomIntInclusive(0, handlers.length - 1)] });
    }
  }

  private async collectConfirm(context: ConfirmContext) {
    const { confirmed, unconfirmed, height } = context;
    const td = this.backend.getTotalDifficulty();

    const handlers = this.pool.handlers.filter(({ peer: { peerId }, status }) => {
      return new BN(status!.totalDifficulty).gt(td) && !confirmed.has(peerId) && !unconfirmed.has(peerId);
    });
    if (handlers.length === 0) {
      return;
    }

    const results = await Promise.all(handlers.map(this.downloadDataFromPeer.bind(this, height)));
    for (let i = 0; i < results.length; i++) {
      const handler = handlers[i];
      const result = results[i];
      if (result === null) {
        continue;
      }

      const status = await this.updateConfirmContext(handler, context, result.block, result.receipts, handler.peer.peerId);
      if (status === ConfirmStatus.WaitingForConfirm) {
        // do nothing
      } else if (status === ConfirmStatus.Confirmed || status === ConfirmStatus.Unconfirmed) {
        break;
      }
    }
  }

  private async updateConfirmContext(handler: WireProtocolHandler, context: ConfirmContext, block: Block, receipts: Receipt[], peerId: string): Promise<ConfirmStatus> {
    const { serializedHeader, serializedReceipts, confirmed, unconfirmed, height, td } = context;

    let confirm = true;
    if (!block.header.serialize().equals(serializedHeader)) {
      confirm = false;
    }
    if (serializedReceipts.length !== receipts.length) {
      confirm = false;
    }
    for (let i = 0; i > receipts.length; i++) {
      if (!receipts[i].serialize().equals(serializedReceipts[i])) {
        confirm = false;
        break;
      }
    }

    if (confirm) {
      confirmed.add(peerId);
    } else {
      unconfirmed.add(peerId);
    }

    if (confirmed.size >= confirmLimit) {
      // TODO: ban unconfirmed peers

      await this.resetSyncContext();

      let isSnapSync = false;
      const localHeight = this.backend.getHeight();
      if (height.sub(localHeight).gten(minSnapSyncInterval)) {
        // use snap sync
        await this.snapSync.setRoot(block.header.stateRoot);
        this.snapSync.start();
        isSnapSync = true;
      } else {
        // use full sync
        await this.fullSync.setTarget(handler);
      }

      this.resetConfirmContext();
      this.syncContext = {
        td,
        height,
        block,
        receipts,
        start: localHeight,
        isSnapSync
      };

      return ConfirmStatus.Confirmed;
    } else if (unconfirmed.size >= unconfirmLimit) {
      // TODO: ban confirmed peers
      this.resetConfirmContext();
      return ConfirmStatus.Unconfirmed;
    } else {
      // wait for enough confirm, do nothing
      return ConfirmStatus.WaitingForConfirm;
    }
  }

  private async downloadDataFromPeer(height: BN, handler: WireProtocolHandler): Promise<{ block: Block; receipts: Receipt[] } | null> {
    const header = await handler
      .getBlockHeaders(height, new BN(1))
      .then((headers) => (headers.length === 1 ? headers[0] : null))
      .catch(() => null);
    if (header === null) {
      return null;
    }

    const body = await handler
      .getBlockBodies([header])
      .then((body) => (body.length === 1 ? body[0] : null))
      .catch(() => null);
    if (body === null) {
      return null;
    }

    const block = Block.fromBlockData({ header, transactions: body }, { common: this.backend.getCommon(0), hardforkByBlockNumber: true });
    if (this.validate) {
      try {
        await preValidateBlock.call(block);
      } catch (err) {
        // ignore errors
        return null;
      }
    }

    // TODO: download and validate receipts
    const receipts: Receipt[] = [];

    return { block, receipts };
  }

  announce(ann: Announcement) {
    this.channel.push(ann);
  }

  start() {
    if (this.syncPromise || this.randomPickPromise) {
      throw new Error('promises exist');
    }

    this.syncPromise = this.syncLoop();
    this.enableRandomPick && (this.randomPickPromise = this.randomPickLoop());
  }

  async abort() {
    this.aborted = true;
    this.timer.abort();
    this.channel.abort();
    this.syncPromise && (await this.syncPromise);
    this.randomPickPromise && (await this.randomPickPromise);
    this.resetConfirmContext();
    await this.resetSyncContext();
  }
}
