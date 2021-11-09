import { expect } from 'chai';
import { BN } from 'ethereumjs-util';
import { Evidence, EvidencePool, EvidencePoolBackend } from '../../src/consensus/reimint/types';
import { MockEvidence } from './mockEvidence';

const MAX_UINT64 = new BN('ffffffffffffffff', 'hex');

class MockBackend implements EvidencePoolBackend {
  pendingEvidence: MockEvidence[] = [];
  committedEvidence: MockEvidence[] = [];

  async isCommitted(ev: MockEvidence) {
    return (
      this.committedEvidence.filter((e) => {
        return e.hash().equals(ev.hash());
      }).length > 0
    );
  }

  async isPending(ev: MockEvidence) {
    return (
      this.pendingEvidence.filter((e) => {
        return e.hash().equals(ev.hash());
      }).length > 0
    );
  }

  async addPendingEvidence(ev: MockEvidence) {
    this.pendingEvidence.push(ev);
  }

  async addCommittedEvidence(ev: MockEvidence) {
    this.committedEvidence.push(ev);
  }

  async removePendingEvidence(ev: MockEvidence) {
    const index = this.pendingEvidence.findIndex((x) => x.hash().equals(ev.hash()));
    if (index != -1) {
      this.pendingEvidence.splice(index, 1);
    }
  }

  async loadPendingEvidence({ from, to, reverse, onData }: { from?: BN; to?: BN; reverse?: boolean; onData: (data: Evidence) => Promise<boolean> }): Promise<void> {
    from = from ?? new BN(0);
    to = to ?? MAX_UINT64;
    const filtered = this.pendingEvidence.filter((ev) => ev.height.gte(from!) && ev.height.lte(to!));
    filtered.sort((a, b) => {
      const num = a.height.cmp(b.height);
      return reverse ? num * -1 : num;
    });

    let ev: Evidence | undefined;
    while ((ev = filtered.shift()) && !(await onData(ev))) {}
  }
}

const backend = new MockBackend();
const evpool = new EvidencePool({ backend, maxCacheSize: 5, maxAgeNumBlocks: new BN(6) });

const getPoolInfo = (): {
  height: BN;
  pruningHeight: BN;
  cachedPendingEvidence: MockEvidence[];
} => {
  const _evpool = evpool as any;
  return {
    height: _evpool.height.clone(),
    pruningHeight: _evpool.pruningHeight.clone(),
    cachedPendingEvidence: [..._evpool.cachedPendingEvidence]
  };
};

describe('EvidencePool', () => {
  before(async () => {
    await evpool.init(new BN(10));
  });

  it('should add successfully(1)', async () => {
    for (let i = 0; i < 5; i++) {
      await evpool.addEvidence(new MockEvidence(new BN(i + 5)));
    }

    // current pending: 5, 6, 7, 8, 9

    expect(backend.committedEvidence.length).be.equal(0);
    expect(backend.pendingEvidence.length).be.equal(5);
    for (let i = 0; i < 5; i++) {
      expect(backend.pendingEvidence[i].height.toNumber()).be.equal(i + 5);
    }

    const { cachedPendingEvidence } = getPoolInfo();
    expect(cachedPendingEvidence.length).be.equal(5);
    for (let i = 0; i < 5; i++) {
      expect(cachedPendingEvidence[i].height.toNumber()).be.equal(i + 5);
    }
  });

  it('should add failed(expired)', async () => {
    for (let i = 0; i < 5; i++) {
      await evpool.addEvidence(new MockEvidence(new BN(i)));
    }

    expect(backend.committedEvidence.length).be.equal(0);
    expect(backend.pendingEvidence.length).be.equal(5);
  });

  it('should update successfully(1)', async () => {
    await evpool.update([], new BN(11));

    // current pending: 6, 7, 8, 9

    expect(backend.committedEvidence.length).be.equal(0);
    expect(backend.pendingEvidence.length).be.equal(4);
    for (let i = 0; i < 4; i++) {
      expect(backend.pendingEvidence[i].height.toNumber()).be.equal(i + 6);
    }

    const { height, pruningHeight, cachedPendingEvidence } = getPoolInfo();
    expect(cachedPendingEvidence.length).be.equal(4);
    for (let i = 0; i < 4; i++) {
      expect(cachedPendingEvidence[i].height.toNumber()).be.equal(i + 6);
    }

    expect(height.toNumber()).be.equal(11);
    expect(pruningHeight.toNumber()).be.equal(12);
  });

  it('should update successfully(2)', async () => {
    await evpool.update([new MockEvidence(new BN(9))], new BN(12));

    // current pending: 7, 8
    // current committed: 9

    expect(backend.committedEvidence.length).be.equal(1);
    expect(backend.committedEvidence[0].height.toNumber()).be.equal(9);

    expect(backend.pendingEvidence.length).be.equal(2);
    for (let i = 0; i < 2; i++) {
      expect(backend.pendingEvidence[i].height.toNumber()).be.equal(i + 7);
    }

    const { height, pruningHeight, cachedPendingEvidence } = getPoolInfo();
    expect(cachedPendingEvidence.length).be.equal(2);
    for (let i = 0; i < 2; i++) {
      expect(cachedPendingEvidence[i].height.toNumber()).be.equal(i + 7);
    }

    expect(height.toNumber()).be.equal(12);
    expect(pruningHeight.toNumber()).be.equal(13);
  });

  it('should add failed(committed)', async () => {
    await evpool.addEvidence(new MockEvidence(new BN(9)));

    expect(backend.committedEvidence.length).be.equal(1);
    expect(backend.committedEvidence[0].height.toNumber()).be.equal(9);

    expect(backend.pendingEvidence.length).be.equal(2);
    for (let i = 0; i < 2; i++) {
      expect(backend.pendingEvidence[i].height.toNumber()).be.equal(i + 7);
    }

    const { cachedPendingEvidence } = getPoolInfo();
    expect(cachedPendingEvidence.length).be.equal(2);
    for (let i = 0; i < 2; i++) {
      expect(cachedPendingEvidence[i].height.toNumber()).be.equal(i + 7);
    }
  });

  it('should check failed(conflicts)', async () => {
    const result = await evpool.checkEvidence([new MockEvidence(new BN(10)), new MockEvidence(new BN(10))]);
    expect(result).be.false;
  });

  it('should check faild(expired)', async () => {
    const result = await evpool.checkEvidence([new MockEvidence(new BN(1))]);
    expect(result).be.false;
  });

  it('should check faild(committed)', async () => {
    const result = await evpool.checkEvidence([new MockEvidence(new BN(9))]);
    expect(result).be.false;
  });

  it('should check successfully', async () => {
    const result = await evpool.checkEvidence([new MockEvidence(new BN(10))]);

    // current pending: 7, 8, 10
    // current committed: 9

    expect(result).be.true;

    expect(backend.committedEvidence.length).be.equal(1);
    expect(backend.committedEvidence[0].height.toNumber()).be.equal(9);

    expect(backend.pendingEvidence.length).be.equal(3);
    expect(backend.pendingEvidence[0].height.toNumber()).be.equal(7);
    expect(backend.pendingEvidence[1].height.toNumber()).be.equal(8);
    expect(backend.pendingEvidence[2].height.toNumber()).be.equal(10);

    const { cachedPendingEvidence } = getPoolInfo();
    expect(cachedPendingEvidence.length).be.equal(3);
    expect(cachedPendingEvidence[0].height.toNumber()).be.equal(7);
    expect(cachedPendingEvidence[1].height.toNumber()).be.equal(8);
    expect(cachedPendingEvidence[2].height.toNumber()).be.equal(10);
  });

  it('should add successfully(too many)', async () => {
    for (let i = 0; i < 5; i++) {
      await evpool.addEvidence(new MockEvidence(new BN(i + 10)));
    }

    // current pending: 7, 8, 10, 11, 12, 13, 14
    // current committed: 9

    expect(backend.committedEvidence.length).be.equal(1);
    expect(backend.committedEvidence[0].height.toNumber()).be.equal(9);

    expect(backend.pendingEvidence.length).be.equal(7);
    expect(backend.pendingEvidence[0].height.toNumber()).be.equal(7);
    expect(backend.pendingEvidence[1].height.toNumber()).be.equal(8);
    expect(backend.pendingEvidence[2].height.toNumber()).be.equal(10);
    expect(backend.pendingEvidence[3].height.toNumber()).be.equal(11);
    expect(backend.pendingEvidence[4].height.toNumber()).be.equal(12);
    expect(backend.pendingEvidence[5].height.toNumber()).be.equal(13);
    expect(backend.pendingEvidence[6].height.toNumber()).be.equal(14);

    const { cachedPendingEvidence } = getPoolInfo();
    expect(cachedPendingEvidence.length).be.equal(5);
    for (let i = 0; i < 5; i++) {
      expect(cachedPendingEvidence[i].height.toNumber()).be.equal(i + 10);
    }
  });
});
