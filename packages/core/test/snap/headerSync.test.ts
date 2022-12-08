import { BN } from 'ethereumjs-util';
import { assert, expect } from 'chai';
import { BlockHeader } from '@rei-network/structure';
import { HeaderSyncPeer, HeaderSyncNetworkManager, IHeaderSyncBackend, HeaderSync } from '../../src/sync/snap';
import { Common } from '@rei-network/common';
import { Database } from '@rei-network/database';
import { preValidateHeader } from '../../src/validation';
import { randomBytes } from 'crypto';

class MockBackend implements IHeaderSyncBackend {
  async handlePeerError(prefix: string, peer: HeaderSyncPeer, err: any): Promise<void> {
    // do nothing
    console.log('handlePeerError', prefix, peer, err);
  }

  validateHeaders(child: BlockHeader, headers: BlockHeader[]) {
    for (let i = headers.length - 1; i >= 0; i--) {
      preValidateHeader.call(child, headers[i]);
      child = headers[i];
    }
    return child;
  }
}

class MockHeaderSyncPeer implements HeaderSyncPeer {
  private headers: BlockHeader[] = [];
  mockSetBlockHeaders(headers: BlockHeader[]) {
    this.headers = headers;
  }
  getBlockHeaders(start: BN, count: BN): Promise<BlockHeader[]> {
    return new Promise((resolve, reject) => {
      const response: BlockHeader[] = [];
      for (let i = 0; i < this.headers.length; i++) {
        if (this.headers[i].number.gte(start) && response.length < count.toNumber()) {
          response.push(this.headers[i]);
        }
      }
      resolve(response);
    });
  }
}

class MockHeaderSyncNetworkManager implements HeaderSyncNetworkManager {
  peers: Array<HeaderSyncPeer> = [];
  constructor(count: number = 10) {
    for (let i = 0; i < count; i++) {
      this.peers.push(new MockHeaderSyncPeer());
    }
  }
  get(): Promise<HeaderSyncPeer> {
    return new Promise((resolve, reject) => {
      const peer = this.peers.pop();
      if (!peer) {
        reject('no peer');
      }
      resolve(peer!);
    });
  }
  put(peer: HeaderSyncPeer): void {
    this.peers.push(peer);
  }
}

const level = require('level-mem');

describe('HeaderSync', () => {
  let db: Database;
  let common: Common;

  beforeEach(async () => {
    const levelDB = level();
    common = new Common({ chain: 'rei-devnet' });
    common.setHardforkByBlockNumber(0);
    db = new Database(levelDB, common);
  });

  it('should download 99 block headers before the specified block header to the database', async () => {
    const count = 100;
    const { headers, backend, wirePool } = initDev(count, common);
    const headerSync = new HeaderSync({
      db,
      backend,
      wireHandlerPool: wirePool,
      maxGetBlockHeaders: new BN(128)
    });

    headerSync.on('synced', (stateRoot: Buffer) => {
      assert(stateRoot.equals(headers[headers.length - 2].stateRoot));
    });
    await headerSync.startSync(headers[headers.length - 1]);

    for (let i = 0; i <= 98; i++) {
      const header = headers[i];
      assert((await db.getHeader(header.hash(), header.number)).stateRoot.equals(header.stateRoot));
      assert((await db.numberToHash(header.number)).equals(header.hash()));
      assert((await db.hashToNumber(header.hash())).eq(header.number));
    }
  });

  it('should download 128 block headers before the specified block header to the database', async () => {
    const count = 129;
    const { headers, backend, wirePool } = initDev(count, common);
    const headerSync = new HeaderSync({
      db,
      backend,
      wireHandlerPool: wirePool,
      maxGetBlockHeaders: new BN(128)
    });

    headerSync.on('synced', (stateRoot: Buffer) => {
      assert(stateRoot.equals(headers[headers.length - 2].stateRoot));
    });
    await headerSync.startSync(headers[headers.length - 1]);

    for (let i = 0; i <= 127; i++) {
      const header = headers[i];
      assert((await db.getHeader(header.hash(), header.number)).stateRoot.equals(header.stateRoot));
      assert((await db.numberToHash(header.number)).equals(header.hash()));
      assert((await db.hashToNumber(header.hash())).eq(header.number));
    }
  });

  it('should download 256 block headers before the specified block header to the database when the lastest block height equal to 256', async () => {
    const count = 257;
    const { headers, backend, wirePool } = initDev(count, common);
    const headerSync = new HeaderSync({
      db,
      backend,
      wireHandlerPool: wirePool,
      maxGetBlockHeaders: new BN(128)
    });

    headerSync.on('synced', (stateRoot: Buffer) => {
      assert(stateRoot.equals(headers[headers.length - 2].stateRoot));
    });
    await headerSync.startSync(headers[headers.length - 1]);

    for (let i = 0; i <= 255; i++) {
      const header = headers[i];
      assert((await db.getHeader(header.hash(), header.number)).stateRoot.equals(header.stateRoot));
      assert((await db.numberToHash(header.number)).equals(header.hash()));
      assert((await db.hashToNumber(header.hash())).eq(header.number));
    }
  });

  it('should download 256 block headers before the specified block header to the database when the lastest block height greater than 256', async () => {
    const count = 500;
    const { headers, backend, wirePool } = initDev(count, common);
    const headerSync = new HeaderSync({
      db,
      backend,
      wireHandlerPool: wirePool,
      maxGetBlockHeaders: new BN(128)
    });

    headerSync.on('synced', (stateRoot: Buffer) => {
      assert(stateRoot.equals(headers[headers.length - 2].stateRoot));
    });
    await headerSync.startSync(headers[headers.length - 1]);

    for (let i = 2; i <= 257; i++) {
      const header = headers[headers.length - i];
      assert((await db.getHeader(header.hash(), header.number)).stateRoot.equals(header.stateRoot));
      assert((await db.numberToHash(header.number)).equals(header.hash()));
      assert((await db.hashToNumber(header.hash())).eq(header.number));
    }
  });

  it('should reset the block header and download 99 block headers before the specified block header to the database', async () => {
    const count = 100;
    const { headers, backend, wirePool } = initDev(count, common);
    const headerSync = new HeaderSync({
      db,
      backend,
      wireHandlerPool: wirePool,
      maxGetBlockHeaders: new BN(128)
    });
    headerSync.startSync(headers[Math.round(count / 2)]);
    await headerSync.reset(headers[headers.length - 1]);
    for (let i = 0; i <= 98; i++) {
      const header = headers[i];
      assert((await db.getHeader(header.hash(), header.number)).stateRoot.equals(header.stateRoot));
      assert((await db.numberToHash(header.number)).equals(header.hash()));
      assert((await db.hashToNumber(header.hash())).eq(header.number));
    }
  });

  it('should reset the block header and download 128 block headers before the specified block header to the database', async () => {
    const count = 129;
    const { headers, backend, wirePool } = initDev(count, common);
    const headerSync = new HeaderSync({
      db,
      backend,
      wireHandlerPool: wirePool,
      maxGetBlockHeaders: new BN(128)
    });
    headerSync.startSync(headers[Math.round(count / 2)]);
    await headerSync.reset(headers[headers.length - 1]);
    for (let i = 0; i <= 127; i++) {
      const header = headers[i];
      assert((await db.getHeader(header.hash(), header.number)).stateRoot.equals(header.stateRoot));
      assert((await db.numberToHash(header.number)).equals(header.hash()));
      assert((await db.hashToNumber(header.hash())).eq(header.number));
    }
  });

  it('should reset the block header and download 256 block headers before the specified block header to the database when the lastest block equal to 256', async () => {
    const count = 257;
    const { headers, backend, wirePool } = initDev(count, common);
    const headerSync = new HeaderSync({
      db,
      backend,
      wireHandlerPool: wirePool,
      maxGetBlockHeaders: new BN(128)
    });
    headerSync.startSync(headers[Math.round(count / 2)]);
    await headerSync.reset(headers[headers.length - 1]);
    for (let i = 2; i <= 257; i++) {
      const header = headers[headers.length - i];
      assert((await db.getHeader(header.hash(), header.number)).stateRoot.equals(header.stateRoot));
      assert((await db.numberToHash(header.number)).equals(header.hash()));
      assert((await db.hashToNumber(header.hash())).eq(header.number));
    }
  });

  it('should reset the block header and download 256 block headers before the specified block header to the database when the lastest block height greater than 256', async () => {
    const count = 500;
    const { headers, backend, wirePool } = initDev(count, common);
    const headerSync = new HeaderSync({
      db,
      backend,
      wireHandlerPool: wirePool,
      maxGetBlockHeaders: new BN(128)
    });
    headerSync.startSync(headers[Math.round(count / 2)]);
    await headerSync.reset(headers[headers.length - 1]);
    for (let i = 2; i <= 257; i++) {
      const header = headers[headers.length - i];
      assert((await db.getHeader(header.hash(), header.number)).stateRoot.equals(header.stateRoot));
      assert((await db.numberToHash(header.number)).equals(header.hash()));
      assert((await db.hashToNumber(header.hash())).eq(header.number));
    }
  });

  it('should tries to download data 10 times and throws exception', async () => {
    const count = 10;
    const { headers, backend, wirePool } = initDev(count, common, 0);
    const headerSync = new HeaderSync({
      db,
      backend,
      wireHandlerPool: wirePool,
      maxGetBlockHeaders: new BN(128),
      testMode: true
    });
    try {
      await headerSync.startSync(headers[headers.length - 1]);
    } catch (error) {
      assert(error === 'no peer');
    }
  });
});

function createBlockHeaders(num: number = 256, common: Common) {
  const headers: BlockHeader[] = [];
  const time = new BN(Date.now());
  let paraentHash: Buffer;
  for (let i = 0; i < num; i++) {
    const data = { number: new BN(i), timestamp: time.iaddn(3000), difficulty: new BN(1), gasLimit: new BN(20000000), stateRoot: randomBytes(32) };
    const options = { common };
    if (i === 0) {
      const gensisHeader = BlockHeader.genesis(data, options);
      paraentHash = gensisHeader.hash();
      headers.push(gensisHeader);
      continue;
    }
    data['parentHash'] = paraentHash!;
    const header = BlockHeader.fromHeaderData(data, options);
    paraentHash = header.hash();
    headers.push(header);
  }
  return headers;
}

function initDev(count: number, common: Common, peersCount?: number) {
  let headers = createBlockHeaders(count, common);
  let backend = new MockBackend();
  let wirePool = new MockHeaderSyncNetworkManager(peersCount);
  for (let i = 0; i < wirePool.peers.length; i++) {
    (wirePool.peers[i] as any).mockSetBlockHeaders(headers);
  }
  return { headers, backend, wirePool };
}
