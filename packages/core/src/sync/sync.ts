import { BN, BNLike } from 'ethereumjs-util';
import { Channel, getRandomIntInclusive, logger, AbortableTimer } from '@rei-network/utils';
import { Block, Receipt } from '@rei-network/structure';
import { Common } from '@rei-network/common';
import { preValidateBlock } from '../validation';
import { WireProtocolHandler, HandlerPool } from '../protocols';
import { SnapSync } from './snap';

const maxSnapSyncLimit = 200;
const minSnapSyncInterval = 100000;
const confirmLimit = 3;
const confirmTimeout = 3000;
const unconfirmLimit = 3;

export type Announcement = {
  handler: WireProtocolHandler;
  block?: Block;
};

type SyncContext = {
  td: BN;
  start: BN;
  height: BN;
  block: Block;
  receipts: Receipt[];

  snapSync?: SnapSync;
  fullSync?: any;
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

export interface SyncBackend {
  getCommon(num: BNLike): Common;
  getHeight(): BN;
  getTotalDifficulty(): BN;
}

export class Sync {
  private readonly backend: SyncBackend;
  private readonly pool: HandlerPool<WireProtocolHandler>;
  private readonly channel = new Channel<Announcement>();

  private aborted: boolean = false;
  private isWorking: boolean = false;
  private timer = new AbortableTimer();

  private syncContext?: SyncContext;
  private confirmContext?: ConfirmContext;

  private syncPromise?: Promise<void>;
  private randomPickPromise?: Promise<void>;

  constructor(backend: SyncBackend, pool: HandlerPool<WireProtocolHandler>) {
    this.backend = backend;
    this.pool = pool;
  }

  private resetConfirmContext(ctx?: ConfirmContext) {
    this.confirmContext && clearTimeout(this.confirmContext.timeout);
    this.confirmContext = ctx;
  }

  private async abortSync() {
    if (this.syncContext) {
      const { snapSync, fullSync } = this.syncContext;
      // TODO: abort full sync
      snapSync && (await snapSync.abort());
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
        const getRemoteBlock = async () => {
          if (block) {
            return block;
          }

          const [header] = await handler.getBlockHeaders(height, new BN(1));
          const [body] = await handler.getBlockBodies([header]);
          block = Block.fromBlockData({ header, transactions: body }, { common: this.backend.getCommon(0), hardforkByBlockNumber: true });

          try {
            await preValidateBlock.call(block);
          } catch (err) {
            // TODO: ban remote peer
            throw err;
          }

          return block;
        };

        let receipts: Receipt[] | undefined;
        const getRemoteReceipts = async (): Promise<Receipt[]> => {
          if (receipts) {
            return receipts;
          }

          // TODO: download receipt
          // TODO: validate receipt
          return [];
        };

        const resetConfirmContextToCurrent = async () => {
          const block = await getRemoteBlock();
          const receipts = await getRemoteReceipts();

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
        };

        if (this.confirmContext) {
          const { td: confirmTD, confirmed, unconfirmed, serializedHeader, serializedReceipts } = this.confirmContext;
          if (confirmTD.lte(this.backend.getTotalDifficulty())) {
            this.resetConfirmContext();
          } else if (td.gte(confirmTD) && !confirmed.has(peerId) && !unconfirmed.has(peerId)) {
            const block = await getRemoteBlock();
            const receipts = await getRemoteReceipts();

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

              await this.abortSync();

              let snapSync: SnapSync | undefined;
              let fullSync: any;
              const localHeight = this.backend.getHeight();
              if (height.sub(localHeight).gten(minSnapSyncInterval)) {
                // use snap sync
                snapSync = this.syncContext?.snapSync ?? new SnapSync('db' as any, 'network' as any); // TODO
                await snapSync.setRoot(block.header.stateRoot);
                snapSync.start();
              } else {
                // use full sync
                fullSync = 'full' as any; // TODO
              }

              this.resetConfirmContext();
              this.syncContext = {
                td: confirmTD,
                height,
                block,
                receipts,
                start: localHeight,
                snapSync,
                fullSync
              };

              continue;
            } else if (unconfirmed.size >= unconfirmLimit) {
              // TODO: ban confirmed peers

              this.resetConfirmContext();
            }
          }
        }

        if (this.syncContext) {
          const { snapSync, height: syncHeight } = this.syncContext;
          if (snapSync) {
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

    const results = await Promise.all(
      handlers.map(async (handler): Promise<{ block: Block; receipts: Receipt[] } | null> => {
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
        try {
          await preValidateBlock.call(block);
        } catch (err) {
          // ignore errors
          return null;
        }

        // TODO: download and validate receipts
        const receipts: Receipt[] = [];

        return { block, receipts };
      })
    );

    for (let i = 0; i < results.length; i++) {
      const handler = handlers[i];
      const result = results[i];
      if (result === null) {
        continue;
      }

      if (await this.updateConfirmContext(context, result.block, result.receipts, handler.peer.peerId)) {
        break;
      }
    }
  }

  private async updateConfirmContext(context: ConfirmContext, block: Block, receipts: Receipt[], peerId: string) {
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

      await this.abortSync();

      let snapSync: SnapSync | undefined;
      let fullSync: any;
      const localHeight = this.backend.getHeight();
      if (height.sub(localHeight).gten(minSnapSyncInterval)) {
        // use snap sync
        snapSync = this.syncContext?.snapSync ?? new SnapSync('db' as any, 'network' as any); // TODO
        await snapSync.setRoot(block.header.stateRoot);
        snapSync.start();
      } else {
        // use full sync
        fullSync = 'full' as any; // TODO
      }

      this.resetConfirmContext();
      this.syncContext = {
        td,
        height,
        block,
        receipts,
        start: localHeight,
        snapSync,
        fullSync
      };

      return true;
    } else if (unconfirmed.size >= unconfirmLimit) {
      // TODO: ban confirmed peers

      this.resetConfirmContext();

      return true;
    } else {
      // wait for enough confirm, do nothing
      return false;
    }
  }

  announce(ann: Announcement) {
    this.channel.push(ann);
  }

  start(enableRandomPick: boolean = true) {
    if (this.syncPromise || this.randomPickPromise) {
      throw new Error('promises exist');
    }

    this.syncPromise = this.syncLoop();
    enableRandomPick && (this.randomPickPromise = this.randomPickLoop());
  }

  async abort() {
    this.aborted = true;
    this.timer.abort();
    this.channel.abort();
    this.syncPromise && (await this.syncPromise);
    this.randomPickPromise && (await this.randomPickPromise);
  }
}
