import { EventEmitter } from 'events';
import { expect } from 'chai';
import { BN, BNLike, toBuffer } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { Block, BlockHeader, Receipt, Transaction } from '@rei-network/structure';
import { NodeStatus } from '../../src/types';
import { EMPTY_HASH } from '../../src/utils';
import { SyncBackend, IFetcher, Sync, FetchResult, FetchingResult, SyncContext } from '../../src/sync/sync';
import { HandlerPool } from '../../src/protocols/handlerPool';
import { WireProtocolHandler } from '../../src/protocols';

const common = new Common({ chain: 'rei-devnet' });
common.setHardforkByBlockNumber(0);

const privateKey = toBuffer('0xd8ca4883bbf62202904e402750d593a297b5640dea80b6d5b239c5a9902662c0');

class MockWireHandler extends EventEmitter {
  readonly index: number;
  readonly srcBlocks: Block[];

  status!: NodeStatus;

  constructor(index: number, srcBlocks: Block[]) {
    super();
    this.index = index;
    this.srcBlocks = srcBlocks;
  }

  get peer() {
    return {
      peerId: this.index.toString()
    };
  }

  setBlock(block: Block) {
    this.status = {
      networkId: 100,
      totalDifficulty: block.header.number.toBuffer(),
      height: block.header.number.toNumber(),
      bestHash: block.header.hash(),
      genesisHash: EMPTY_HASH
    };
    this.emit('changed', this, block);
  }

  async getBlockHeaders(from: BN, to: BN) {
    const blocks = this.srcBlocks.slice(0, this.status.height + 1);
    const res = blocks.slice(from.toNumber(), from.add(to).toNumber() + 1).map(({ header }) => header);
    return res;
  }

  async getBlockBodies(headers: BlockHeader[]) {
    const blocks = this.srcBlocks.slice(0, this.status.height + 1);
    return blocks.slice(headers[0].number.toNumber(), headers[headers.length - 1].number.toNumber() + 1).map(({ transactions }) => transactions);
  }
}

class MockSyncBackend implements SyncBackend {
  header!: BlockHeader;

  setHeader(header: BlockHeader) {
    this.header = header;
  }

  getCommon(num: BNLike): Common {
    const _common = common.copy();
    _common.setHardforkByBlockNumber(num);
    return _common;
  }

  getHeight(): BN {
    return this.header.number.clone();
  }

  getTotalDifficulty(): BN {
    return this.header.number.clone();
  }
}

class MockFetcher implements IFetcher {
  isSnapSync: boolean = false;

  private resolve?: (result: FetchingResult) => void;

  get isFetching() {
    return !!this.resolve;
  }

  finish(result: FetchingResult) {
    if (!this.resolve) {
      throw new Error('invalid finish');
    }

    this.resolve(result);
    this.resolve = undefined;
  }

  async fetch(handler: WireProtocolHandler, block: Block, receipts: Receipt[]): Promise<FetchResult> {
    if (this.resolve) {
      throw new Error('invalid fetch');
    }

    return {
      isSnapSync: this.isSnapSync,
      start: new BN(0),
      fetching: new Promise<FetchingResult>((resolve) => {
        this.resolve = resolve;
      })
    };
  }

  async abort(): Promise<void> {
    if (this.resolve) {
      this.resolve({ reorg: false, saveBlock: false });
      this.resolve = undefined;
    }
  }
}

function generateBlock(height: BN) {
  const _common = common.copy();
  _common.setHardforkByBlockNumber(height);
  const tx = Transaction.fromTxData({ value: height.clone() }, { common: _common }).sign(privateKey);
  const block = Block.fromBlockData({ header: { number: height.clone() }, transactions: [tx] }, { common: _common });
  return block;
}

describe('Sync', () => {
  const srcBlocks: Block[] = [];
  const dstBackend = new MockSyncBackend();

  const fetcher = new MockFetcher();
  const pool = new HandlerPool<MockWireHandler>();

  let sync!: Sync;
  const synchronizedListener = (ctx: SyncContext) => {
    dstBackend.setHeader(ctx.block.header);
  };

  before(async () => {
    const block = generateBlock(new BN(0));
    srcBlocks.push(block);
    dstBackend.setHeader(block.header);
    for (let i = 0; i < 10; i++) {
      const handler = new MockWireHandler(i, srcBlocks);
      handler.on('changed', (handler: MockWireHandler, block: Block) => {
        sync && sync.announce({ handler: handler as any, block });
      });
      handler.setBlock(block);
      pool.add(handler);
    }
  });

  beforeEach(() => {
    sync = new Sync({
      backend: dstBackend,
      pool: pool as any,
      fetcher,
      enableRandomPick: false,
      validate: false
    }).on('synchronized', synchronizedListener);
    sync.start();
  });

  afterEach(async () => {
    if (sync) {
      sync.off('synchronized', synchronizedListener);
      await sync.abort();
      sync = undefined as any;
    }
  });

  it('should sync succeed', async () => {
    const start = srcBlocks.length;
    for (let i = start; i < start + 5; i++) {
      const block = generateBlock(new BN(i));
      srcBlocks.push(block);
    }

    const latestBlock = srcBlocks[srcBlocks.length - 1];
    for (let i = 0; i < 3; i++) {
      const handler = pool.handlers[i];
      handler.setBlock(latestBlock);

      if (i < 2) {
        expect(sync.isSyncing, 'should not start sync').be.false;
      } else if (i === 2) {
        await new Promise<void>((r) => setTimeout(r, 10));
        expect(fetcher.isFetching, 'should start fetching').be.true;
        expect(sync.isSyncing, 'should start sync').be.true;
        const syncContext = sync.syncContext!;
        expect(syncContext.td.eq(latestBlock.header.number)).be.true;
        expect(syncContext.block.hash().equals(latestBlock.hash())).be.true;
        expect(syncContext.height.eq(latestBlock.header.number)).be.true;
        expect(syncContext.isSnapSync).be.equal(fetcher.isSnapSync);
        expect(syncContext.start.eqn(start - 1)).be.true;
      }
    }

    fetcher.finish({ reorg: true, saveBlock: false });
    expect(fetcher.isFetching, 'should not fetching').be.false;
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(sync.isSyncing, 'should start sync').be.false;
    expect(dstBackend.getHeight().eqn(start - 1 + 5)).be.true;
  });
});
