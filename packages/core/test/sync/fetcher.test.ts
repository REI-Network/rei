import { BN } from 'ethereumjs-util';
import { expect, assert } from 'chai';
import { Common } from '@rei-network/common';
import { Block, BlockHeader, Transaction } from '@rei-network/structure';
import { setLevel } from '@rei-network/utils';
import { Fetcher, FetcherBackend, FetcherValidateBackend } from '../../src/sync/fetcher';
import { CommitBlockOptions } from '../../src/types';
import { HandlerPool, GetHandlerTimeoutError } from '../../src/protocols/handlerPool';
import { ConsensusEngine } from '../../src/consensus';

setLevel('silent');
const common = Common.createCommonByBlockNumber(0, 'rei-testnet');
const decl = 10;

class MockFetcherBackend implements FetcherBackend, FetcherValidateBackend {
  getEngineByCommon(common: Common): ConsensusEngine {
    throw new Error('Method not implemented.');
  }
  commitBlock(options: CommitBlockOptions): Promise<boolean> {
    throw new Error('Method not implemented.');
  }
  lastestNumber?: BN;

  async processAndCommitBlock(block: Block) {
    if (this.lastestNumber !== undefined && !this.lastestNumber.addn(1).eq(block.header.number)) {
      throw new Error('process invalid block');
    }
    this.lastestNumber = block.header.number.clone();

    await new Promise((r) => setTimeout(r, 1));

    return true;
  }

  reset() {
    this.lastestNumber = undefined;
  }

  async handleNetworkError(prefix: string, peerId: string, reason: string) {}

  validateHeaders(parent: BlockHeader | undefined, headers: BlockHeader[]): BlockHeader {
    return headers[headers.length - 1];
  }

  validateBodies() {}

  async validateBlocks() {}
}

class MockProtocolHander {
  peer: any;
  readonly index: number;
  readonly protocol: MockProtocol;

  readonly downloadHeaders = new Set<number>();
  readonly downloadBodies = new Set<number>();
  throwError = false;

  constructor(index: number, protocol: MockProtocol) {
    this.index = index;
    this.protocol = protocol;
    this.peer = { peerId: `${index}` };
  }

  reset() {
    this.downloadHeaders.clear();
    this.downloadBodies.clear();
    this.throwError = false;
  }

  async getBlockHeaders(start: BN, count: BN) {
    const headers: BlockHeader[] = [];
    for (let i = 0; i < count.toNumber(); i++) {
      const num = start.toNumber() + i;
      if (this.downloadHeaders.has(num)) {
        throw new Error('repeated download header:' + num);
      }
      this.downloadHeaders.add(num);

      headers.push(
        BlockHeader.fromHeaderData(
          {
            number: new BN(num)
          },
          { common, hardforkByBlockNumber: true }
        )
      );
    }
    await new Promise((r) => setTimeout(r, decl));
    return headers;
  }

  async getBlockBodies(headers: BlockHeader[]) {
    await new Promise((r) => setTimeout(r, decl));
    if (this.protocol.throwError) {
      this.protocol.throwError = false;
      this.throwError = true;
      throw new Error('failed');
    } else {
      headers.forEach((header) => {
        const num = header.number.toNumber();
        if (this.downloadBodies.has(num)) {
          throw new Error('repeated download body:' + num);
        }
        this.downloadBodies.add(num);
      });
      return new Array<Transaction[]>(headers.length).fill([]);
    }
  }
}

class MockHandlerPool extends HandlerPool<MockProtocolHander> {
  timeout: number = 0;

  reset() {
    this.timeout = 0;
  }

  async get() {
    if (this.timeout !== 0) {
      const timeout = this.timeout;
      this.timeout = 0;
      await new Promise((r) => setTimeout(r, timeout));
      throw new GetHandlerTimeoutError('ProtocolPool get handler timeout');
    } else {
      return super.get();
    }
  }
}

class MockProtocol {
  readonly pool = new MockHandlerPool();
  throwError = false;

  reset() {
    this.throwError = false;
  }
}

describe('Fetcher', () => {
  const backend = new MockFetcherBackend();
  const protocol = new MockProtocol();
  let targetHandler!: MockProtocolHander;
  for (let i = 0; i < 10; i++) {
    protocol.pool.add((targetHandler = new MockProtocolHander(i, protocol)));
  }

  afterEach(() => {
    for (const handler of protocol.pool.handlers) {
      handler.reset();
    }
    protocol.reset();
    protocol.pool.reset();
    backend.reset();
  });

  it('should fetch successfully', async () => {
    const fetcher = new Fetcher({ common, backend, validateBackend: backend, downloadElementsCountLimit: new BN(decl), downloadBodiesLimit: 5 });
    const start = new BN(0);
    const totalCount = new BN(decl * 10);
    await fetcher.fetch(start, totalCount, targetHandler as any);

    expect(backend.lastestNumber?.toString()).be.equal(totalCount.sub(start).subn(1).toString());

    const downloadBodies = new Set<number>();
    for (const handler of protocol.pool.handlers) {
      if (handler === targetHandler) {
        expect(handler.downloadHeaders.size).be.equal(totalCount.toNumber());
      } else {
        expect(handler.downloadHeaders.size).be.equal(0);
      }

      for (const num of handler.downloadBodies) {
        if (downloadBodies.has(num)) {
          assert.fail('repeated download bodies');
        }
        downloadBodies.add(num);
      }
    }
    expect(downloadBodies.size).be.equal(totalCount.toNumber());
  });

  it('should fetch failed(get peer timeout)', async () => {
    const fetcher = new Fetcher({ common, backend, validateBackend: backend, downloadElementsCountLimit: new BN(decl), downloadBodiesLimit: 5 });
    const start = new BN(0);
    const totalCount = new BN(decl * 10);

    setTimeout(() => {
      protocol.pool.timeout = 5;
    }, 30);

    await fetcher.fetch(start, totalCount, targetHandler as any);

    const num = backend.lastestNumber?.toNumber();
    expect(num === undefined || num < totalCount.toNumber()).be.true;
  });

  it('should fetch successfully(retry get bodies)', async () => {
    const fetcher = new Fetcher({ common, backend, validateBackend: backend, downloadElementsCountLimit: new BN(decl), downloadBodiesLimit: 5 });
    const start = new BN(0);
    const totalCount = new BN(decl * 10);

    setTimeout(() => {
      protocol.throwError = true;
    }, 30);

    await fetcher.fetch(start, totalCount, targetHandler as any);

    expect(backend.lastestNumber?.toString()).be.equal(totalCount.sub(start).subn(1).toString());

    let throwError = false;
    const downloadBodies = new Set<number>();
    for (const handler of protocol.pool.handlers) {
      if (handler === targetHandler) {
        expect(handler.downloadHeaders.size).be.equal(totalCount.toNumber());
      } else {
        expect(handler.downloadHeaders.size).be.equal(0);
      }

      for (const num of handler.downloadBodies) {
        if (downloadBodies.has(num)) {
          assert.fail('repeated download bodies');
        }
        downloadBodies.add(num);
      }

      throwError = throwError || handler.throwError;
    }
    expect(downloadBodies.size).be.equal(totalCount.toNumber());

    expect(throwError).be.true;
  });
});
