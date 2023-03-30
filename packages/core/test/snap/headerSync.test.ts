import { BN } from 'ethereumjs-util';
import { assert } from 'chai';
import { randomBytes } from 'crypto';
import { BlockHeader, HeaderData } from '@rei-network/structure';
import { Common } from '@rei-network/common';
import { Database, DBSetBlockOrHeader, DBOp, DBSaveLookups } from '@rei-network/database';
import { setLevel } from '@rei-network/utils';
import { HeaderSyncPeer, IHeaderSyncBackend, HeaderSync, HeaderSyncOptions } from '../../src/sync/snap';
import { preValidateHeader } from '../../src/validation';
import { HandlerPool } from '../../src/protocols/handlerPool';
const level = require('level-mem');

setLevel('silent');

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
  readonly id: string = randomBytes(16).toString('hex');
  private headers: BlockHeader[] = [];

  constructor(headers: BlockHeader[] = []) {
    this.headers = headers;
  }

  async getBlockHeaders(start: BN, count: BN): Promise<BlockHeader[]> {
    const response: BlockHeader[] = [];
    for (let i = 0; i < this.headers.length; i++) {
      if (this.headers[i].number.gte(start)) {
        response.push(this.headers[i]);
      }
      if (response.length >= count.toNumber()) {
        break;
      }
    }
    return response;
  }
}

const backend = new MockBackend();

describe('HeaderSync', () => {
  it('should throw an exception when headerSync is called repeatedly', async () => {
    const { headerSync, headers } = await createHeaderSyncer(100);
    headerSync.headerSync(headers[headers.length - 1]);
    let catched: any;
    try {
      headerSync.headerSync(headers[headers.length - 1]);
    } catch (err: any) {
      catched = err;
    }
    assert(catched && catched.message === 'Header sync is already running');
  });

  it('should sync block headers when the lastest block height equal to 100', async () => {
    await testHeaderSync(100);
  });

  it('should sync block headers when the lastest block height equal to 128', async () => {
    await testHeaderSync(128);
  });

  it('should sync block headers when the lastest block height equal to 256', async () => {
    await testHeaderSync(256);
  });

  it('should sync block headers when the lastest block height equal to 500', async () => {
    await testHeaderSync(500);
  });

  it('should reset the block header and sync block headers when the lastest block height equal to 100', async () => {
    await testHeaderSyncReset(100);
  });

  it('should reset the block header and sync block headers when the lastest block height equal to 128', async () => {
    await testHeaderSyncReset(128);
  });

  it('should reset the block header and sync block headers when the lastest block height equal to 256', async () => {
    await testHeaderSyncReset(256);
  });

  it('should reset the block header and sync block headers when the lastest block height equal to 500', async () => {
    await testHeaderSyncReset(500);
  });

  it('should tries to download block headers 10 times and throws exception', async () => {
    const { headerSync, headers } = await createHeaderSyncer(10, { throwError: true }, 0);
    let catched: any;
    try {
      headerSync.headerSync(headers[headers.length - 1]);
      await headerSync.wait();
    } catch (err: any) {
      catched = err;
    }
    assert(catched && catched.message === 'reach retry limit');
  });
});

function createBlockHeaders(num: number = 256, common: Common) {
  const headers: BlockHeader[] = [];
  const time = new BN(Date.now());
  let parentHash = BlockHeader.genesis({}, { common }).hash();
  for (let i = 1; i <= num; i++) {
    const data: HeaderData = {
      number: new BN(i),
      timestamp: time.iaddn(3000),
      difficulty: new BN(1),
      gasLimit: new BN(20000000),
      stateRoot: randomBytes(32),
      parentHash
    };
    const header = BlockHeader.fromHeaderData(data, { common });
    headers.push(header);
    parentHash = header.hash();
  }
  return headers;
}

async function createHeaderSyncer(count: number, options?: Omit<HeaderSyncOptions, 'db' | 'backend' | 'pool'>, peersCount: number = 3) {
  const levelDB = level();
  const common = new Common({ chain: 'rei-devnet' });
  common.setHardforkByBlockNumber(0);
  const db = new Database(levelDB, common);
  const headers = createBlockHeaders(count, common);
  const pool: HandlerPool<HeaderSyncPeer> = new HandlerPool();
  for (let i = 0; i < peersCount; i++) {
    const data = i % 2 === 0 ? headers : [];
    pool.add(new MockHeaderSyncPeer(data));
  }
  const headerSync = new HeaderSync({ db, backend, pool, retryInterval: 1, getHandlerTimeout: 1, ...options });
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

async function saveHeaders(headerSync: HeaderSync, headers: BlockHeader[]) {
  await headerSync.db.batch(
    headers.reduce((dbOps: DBOp[], header) => {
      dbOps.push(...DBSetBlockOrHeader(header));
      dbOps.push(...DBSaveLookups(header.hash(), header.number));
      return dbOps;
    }, [])
  );
}

async function testHeaderSync(count: number) {
  const { headerSync, headers } = await createHeaderSyncer(count);
  const promise = new Promise<void>((resolve) => {
    headerSync.on('preRoot', (stateRoot: Buffer) => {
      assert(stateRoot.equals(headers[headers.length - 2].stateRoot));
      resolve();
    });
  });
  await headerSync.headerSync(headers[headers.length - 1]);
  await saveHeaders(headerSync, await headerSync.wait());
  await promise;
  await checkHeaders(headerSync, headers);
}

async function testHeaderSyncReset(count: number) {
  const { headerSync, headers } = await createHeaderSyncer(count);
  headerSync.headerSync(headers[Math.round(count / 2)]);
  await headerSync.abort();
  const promise = new Promise<void>((resolve) => {
    headerSync.on('preRoot', (stateRoot: Buffer) => {
      assert(stateRoot.equals(headers[headers.length - 2].stateRoot));
      resolve();
    });
  });
  await headerSync.headerSync(headers[headers.length - 1]);
  await saveHeaders(headerSync, await headerSync.wait());
  await promise;
  await checkHeaders(headerSync, headers);
}
