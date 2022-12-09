import { BN } from 'ethereumjs-util';
import { assert } from 'chai';
import { randomBytes } from 'crypto';
import { BlockHeader } from '@rei-network/structure';
import { HeaderSyncPeer, IHeaderSyncBackend, HeaderSync } from '../../src/sync/snap';
import { Common } from '@rei-network/common';
import { Database } from '@rei-network/database';
import { preValidateHeader } from '../../src/validation';
import { HandlerPool } from '../../src/protocols/handlerPool';

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
  public id: string;
  private headers: BlockHeader[] = [];
  constructor(headers: BlockHeader[] = []) {
    this.id = randomBytes(16).toString('hex');
    this.headers = headers;
  }
  getBlockHeaders(start: BN, count: BN): Promise<BlockHeader[]> {
    return new Promise((resolve, reject) => {
      const response: BlockHeader[] = [];
      for (let i = 0; i < this.headers.length; i++) {
        if (this.headers[i].number.gte(start)) {
          response.push(this.headers[i]);
        }
        if (response.length >= count.toNumber()) {
          break;
        }
      }
      resolve(response);
    });
  }
}

const level = require('level-mem');
const backend = new MockBackend();

describe('HeaderSync', () => {
  it('should throw an exception when headerSync is called repeatedly', async () => {
    const { headerSync, headers } = await createHeaderSyncer(100);
    headerSync.headerSync(headers[headers.length - 1]);
    try {
      headerSync.headerSync(headers[headers.length - 1]);
    } catch (err) {
      assert((err as any).message === 'Header sync is already running');
    }
  });

  it('should sync block headers when the lastest block height equal to 99', async () => {
    await testHeaderSync(100);
  });

  it('should sync block headers when the lastest block height equal to 128', async () => {
    await testHeaderSync(129);
  });

  it('should sync block headers when the lastest block height equal to 256', async () => {
    await testHeaderSync(257);
  });

  it('should sync block headers when the lastest block height equal to 499', async () => {
    await testHeaderSync(500);
  });

  it('should reset the block header and sync block headers when the lastest block height equal to 99', async () => {
    await testHeaderSyncReset(100);
  });

  it('should reset the block header and sync block headers when the lastest block height equal to 128', async () => {
    await testHeaderSyncReset(129);
  });

  it('should reset the block header and sync block headers when the lastest block height equal to 256', async () => {
    await testHeaderSyncReset(257);
  });

  it('should reset the block header and sync block headers when the lastest block height equal to 499', async () => {
    await testHeaderSyncReset(500);
  });

  it('should tries to download block headers 10 times and throws exception', async () => {
    const count = 10;
    const { headerSync, headers } = await createHeaderSyncer(count, true, 0);
    try {
      await headerSync.headerSync(headers[headers.length - 1]);
    } catch (err) {
      assert((err as any).message === 'ProtocolPool get handler timeout');
    }
  });
});

function createBlockHeaders(num: number = 256, common: Common) {
  const headers: BlockHeader[] = [];
  const time = new BN(Date.now());
  let parentHash: Buffer;
  for (let i = 0; i < num; i++) {
    const data = { number: new BN(i), timestamp: time.iaddn(3000), difficulty: new BN(1), gasLimit: new BN(20000000), stateRoot: randomBytes(32) };
    const options = { common };
    if (i === 0) {
      const gensisHeader = BlockHeader.genesis(data, options);
      parentHash = gensisHeader.hash();
      headers.push(gensisHeader);
      continue;
    }
    data['parentHash'] = parentHash!;
    const header = BlockHeader.fromHeaderData(data, options);
    parentHash = header.hash();
    headers.push(header);
  }
  return headers;
}

async function createHeaderSyncer(count: number, testMode: boolean = false, peersCount?: number) {
  const levelDB = level();
  const common = new Common({ chain: 'rei-devnet' });
  common.setHardforkByBlockNumber(0);
  const db = new Database(levelDB, common);
  const headers = createBlockHeaders(count, common);
  const pool: HandlerPool<HeaderSyncPeer> = new HandlerPool();

  peersCount = peersCount === undefined ? 10 : peersCount;
  for (let i = 0; i < peersCount; i++) {
    const data = i % 2 === 0 ? headers : [];
    pool.add(new MockHeaderSyncPeer(data));
  }
  const headerSync = new HeaderSync({ db, backend, pool });
  return {
    headerSync,
    headers
  };
}

async function checkHeaders(headerSync: HeaderSync, headers: BlockHeader[]) {
  const limit = headers.length > 257 ? 257 : headers.length - 1;
  for (let i = 2; i <= limit; i++) {
    const header = headers[headers.length - i];
    assert((await headerSync.db.getHeader(header.hash(), header.number)).stateRoot.equals(header.stateRoot));
    assert((await headerSync.db.numberToHash(header.number)).equals(header.hash()));
    assert((await headerSync.db.hashToNumber(header.hash())).eq(header.number));
  }
}

async function testHeaderSync(count: number) {
  const { headerSync, headers } = await createHeaderSyncer(count);
  const promise = new Promise<void>((resolve) => {
    headerSync.on('synced', (stateRoot: Buffer) => {
      assert(stateRoot.equals(headers[headers.length - 2].stateRoot));
      resolve();
    });
  });
  await headerSync.headerSync(headers[headers.length - 1]);
  await promise;
  await checkHeaders(headerSync, headers);
}

async function testHeaderSyncReset(count: number) {
  const { headerSync, headers } = await createHeaderSyncer(count);
  headerSync.headerSync(headers[Math.round(count / 2)]);
  await headerSync.abort();
  const promise = new Promise<void>((resolve) => {
    headerSync.on('synced', (stateRoot: Buffer) => {
      assert(stateRoot.equals(headers[headers.length - 2].stateRoot));
      resolve();
    });
  });
  await headerSync.headerSync(headers[headers.length - 1]);
  await promise;
  await checkHeaders(headerSync, headers);
}
