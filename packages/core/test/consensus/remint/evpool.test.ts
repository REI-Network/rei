import { expect } from 'chai';
import { BN } from 'ethereumjs-util';
import { Vote } from '../../../src/consensus/reimint/types/vote';
import { Evidence, DuplicateVoteEvidence } from '../../../src/consensus/reimint/types/evidence';
import { EvidencePool, EvidencePoolBackend } from '../../../src/consensus/reimint/types/evpool';

const evpoolMaxCacheSize = 40;
const evpoolMaxAgeNumBlocks = new BN(5);
const abortHeight = 11;
const aborttime = 3;
let addHeight = abortHeight + 1;

const voteHash = Buffer.from('this a teststring hash length 32');

const createEvidence = (height: BN, index: number) => {
  const voteA = new Vote({ chainId: 1, type: 1, height: new BN(height), round: 1, hash: voteHash, timestamp: Date.now(), index: index });
  voteA.sign(voteHash);
  return new DuplicateVoteEvidence(voteA, voteA, new BN(height));
};

class MockBackend implements EvidencePoolBackend {
  pendingEvidence: Evidence[] = [];
  committedEvidence: Evidence[] = [];

  isCommitted(ev: Evidence) {
    return Promise.resolve(
      this.committedEvidence.filter((e) => {
        return e.hash().equals(ev.hash());
      }).length > 0
    );
  }

  isPending(ev: Evidence) {
    return Promise.resolve(
      this.pendingEvidence.filter((e) => {
        return e.hash().equals(ev.hash());
      }).length > 0
    );
  }

  addPendingEvidence(ev: Evidence) {
    this.pendingEvidence.push(ev);
    return Promise.resolve();
  }

  addCommittedEvidence(ev: Evidence) {
    this.committedEvidence.push(ev);
    return Promise.resolve();
  }

  removePendingEvidence(ev: Evidence) {
    const index = this.pendingEvidence.findIndex((x) => x.hash().equals(ev.hash()));
    if (index != -1) {
      this.pendingEvidence.splice(index, 1);
    }
    return Promise.resolve();
  }

  loadPendingEvidence({ from, to, reverse, onData }: { from?: BN; to?: BN; reverse?: boolean; onData: (data: Evidence) => boolean }): Promise<void> {
    const fromheight = from ? from : new BN(0);
    const toheight = to ? to : new BN(99999);
    const filtered = this.pendingEvidence.filter((ev) => ev.height.gte(fromheight) && ev.height.lte(toheight));
    filtered.sort((a, b) => {
      let result = 0;
      if (a.height.eq(b.height)) {
        result = (a as DuplicateVoteEvidence).voteA.index - (b as DuplicateVoteEvidence).voteA.index;
      } else {
        result = a.height.cmp(b.height);
      }
      if (reverse) {
        result = result * -1;
      }
      return result;
    });
    for (let i = 0; i < filtered.length; i++) {
      if (onData(filtered[i])) {
        break;
      }
    }
    return new Promise<void>((resolve) => {
      resolve();
    });
  }
}

describe('evpool', () => {
  const testbd = new MockBackend();
  const evpool = new EvidencePool(testbd, evpoolMaxCacheSize, evpoolMaxAgeNumBlocks);
  before(async () => {
    await evpool.init(new BN(0));
    for (let i = 0; i < abortHeight; i++) {
      for (let j = 0; j < aborttime; j++) {
        await evpool.addEvidence(createEvidence(new BN(i), j));
      }
    }
  });

  it('should get pendingEvidence correctly', () => {
    expect(evpool.pendingEvidence.length, 'evidence number shoule be euqal').be.equal(abortHeight * aborttime);
  });

  it('should add Evidence correctly', async () => {
    const evToAdd = createEvidence(new BN(addHeight), 0);
    await evpool.addEvidence(evToAdd);
    expect(evpool.pendingEvidence.length, 'evidence number shoule be euqal').be.equal(abortHeight * aborttime + 1);
    const evCache = evpool.pendingEvidence.slice(-1)[0];
    let evdatabase: Evidence[] = [];
    await testbd.loadPendingEvidence({
      reverse: true,
      onData: (ev) => {
        evdatabase.push(ev);
        return true;
      }
    });
    expect(evCache.hash().equals(evToAdd.hash()) && evCache.serialize().equals(evToAdd.serialize()), 'should add Evidence into Cache correctly').be.true;
    expect(evdatabase[0].hash().equals(evToAdd.hash()) && evdatabase[0].serialize().equals(evToAdd.serialize()), 'should add Evidence into Database correctly').be.true;
  });

  it('should pickEvidence correctly', async () => {
    const factor = 3;
    const height = new BN(factor);
    const number = factor * aborttime;
    const result = await evpool.pickEvidence(height, number);
    expect((result.length = number), 'pickEvidence number should correct').be.equal;
    expect(result.slice(-1)[0].height.eq(height.subn(1)), 'pickEvidence height should correct').be.true;
  });

  it('should update correctly', async () => {
    const factorPick = 3;
    const factorUpdate = 9;
    const numberPick = factorPick * aborttime;
    const heightPick = new BN(factorPick);
    const heightUpdate = new BN(factorUpdate);
    const ev = await evpool.pickEvidence(heightPick, numberPick);
    const committedLengthBefore = testbd.committedEvidence.length;
    const pendingLengtgBefore = testbd.pendingEvidence.length;
    await evpool.update(ev, heightUpdate);

    const committedLengthAfter = testbd.committedEvidence.length;
    const pendingLengtgAfter = testbd.pendingEvidence.length;
    expect(committedLengthAfter - committedLengthBefore == ev.length, 'After update the committed evidences should be correct').be.true;
    expect(pendingLengtgBefore - pendingLengtgAfter == (factorUpdate - evpoolMaxAgeNumBlocks.toNumber() + 1) * aborttime, 'After update the pending evidences should be correct').be.true;
  });
});
