import { EventEmitter } from 'events';
import { BN, BNLike, toBuffer } from 'ethereumjs-util';
import { Common } from '@rei-network/common';
import { Block, BlockHeader, Transaction } from '@rei-network/structure';
import { NodeStatus } from '../../src/types';
import { EMPTY_HASH } from '../../src/utils';
import { SyncBackend, ISnapSync, IFullSync, Sync } from '../../src/sync/sync';
import { HandlerPool } from '../../src/protocols/handlerPool';
import { WireProtocolHandler } from '../../src/protocols';
import { expect } from 'chai';

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

class MockSnapSync implements ISnapSync {
  finished: boolean = false;

  async setRoot(root: Buffer): Promise<void> {}

  start(): void {}

  async abort(): Promise<void> {}
}

class MockFullSync implements IFullSync {
  finished: boolean = false;

  async setTarget(handler: WireProtocolHandler): Promise<boolean> {
    return true;
  }

  async abort(): Promise<void> {}
}

function generateBlock(height: BN) {
  const _common = common.copy();
  _common.setHardforkByBlockNumber(height);
  const tx = Transaction.fromTxData(
    {
      value: height.clone()
    },
    { common: _common }
  ).sign(privateKey);
  const block = Block.fromBlockData(
    {
      header: {
        number: height.clone()
      },
      transactions: [tx]
    },
    { common: _common }
  );
  return block;
}

describe('Sync', () => {
  const srcBlocks: Block[] = [];
  const dstBackend = new MockSyncBackend();
  const dstSnapSync = new MockSnapSync();
  const dstFullSync = new MockFullSync();
  const pool = new HandlerPool<MockWireHandler>();

  let sync!: Sync;
  const listener = (handler: MockWireHandler, block: Block) => {
    sync.announce({ handler: handler as any, block });
  };

  before(async () => {
    const block = generateBlock(new BN(0));
    srcBlocks.push(block);
    dstBackend.setHeader(block.header);
    for (let i = 0; i < 10; i++) {
      const handler = new MockWireHandler(i, srcBlocks);
      handler.setBlock(block);
      pool.add(handler);
    }
  });

  beforeEach(() => {
    sync = new Sync({
      backend: dstBackend,
      pool: pool as any,
      snapSync: dstSnapSync,
      fullSync: dstFullSync,
      enableRandomPick: false,
      validate: false
    });
    pool.handlers.forEach((handler) => {
      handler.on('changed', listener);
    });
    sync.start();
  });

  afterEach(async () => {
    if (sync) {
      await sync.abort();
      sync = undefined as any;
    }
    pool.handlers.forEach((handler) => {
      handler.off('changed', listener);
    });
  });

  it('should sync succeed', async () => {
    const start = srcBlocks.length;
    for (let i = start; i < start + 5; i++) {
      const block = generateBlock(new BN(i));
      srcBlocks.push(block);
    }

    const latestBlock = srcBlocks[srcBlocks.length - 1];
    for (let i = 0; i < pool.handlers.length; i++) {
      const handler = pool.handlers[i];
      handler.setBlock(latestBlock);

      if (i < 2) {
        expect(sync.isSyncing, 'should not start sync').be.false;
      } else if (i === 2) {
        await new Promise<void>((r) => setTimeout(r, 10));
        expect(sync.isSyncing, 'should start sync').be.true;
        const syncContext = sync.syncContext!;
        expect(syncContext.td.eq(latestBlock.header.number)).be.true;
        expect(syncContext.block.hash().equals(latestBlock.hash())).be.true;
        expect(syncContext.height.eq(latestBlock.header.number)).be.true;
        expect(syncContext.isSnapSync).be.false;
        expect(syncContext.start.eqn(start - 1)).be.true;
      }
    }
  });
});
