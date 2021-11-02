import { expect } from 'chai';
import { BN, toBuffer } from 'ethereumjs-util';
import { Evidence } from '../../../src/consensus/reimint/types/evidence';
import { EvidencePool, EvidencePoolBackend } from '../../../src/consensus/reimint/types/evpool';

const evpoolMaxCacheSize = 40;
const evpoolMaxAgeNumBlocks = new BN(5);
const abortHeight = 11;
const aborttime = 3;
let addHeight = abortHeight + 1;

class testBackend implements EvidencePoolBackend {
  pendingEvidence: Evidence[] = [];
  committedEvidence: Evidence[] = [];
  constructor() {}

  isCommitted(ev: Evidence) {
    return new Promise<boolean>((resolve) => {
      resolve(
        this.committedEvidence.filter((e) => {
          return e.hash().equals(ev.hash()) && e.serialize().equals(ev.serialize());
        }).length > 0
      );
    });
  }

  isPending(ev: Evidence) {
    return new Promise<boolean>((resolve) => {
      resolve(
        this.pendingEvidence.filter((e) => {
          return e.hash().equals(ev.hash()) && e.serialize().equals(ev.serialize());
        }).length > 0
      );
    });
  }

  addPendingEvidence(ev: Evidence) {
    this.pendingEvidence.push(ev);
  }

  addCommittedEvidence(ev: Evidence) {
    this.committedEvidence.push(ev);
  }

  removePendingEvidence(ev: Evidence) {
    const index = this.pendingEvidence.findIndex((x) => x.hash().equals(ev.hash()) && x.serialize().equals(ev.serialize()));
    if (index != -1) {
      this.pendingEvidence.splice(index, 1);
    }
  }

  loadPendingEvidence({ from, to, reverse, onData }: { from?: BN; to?: BN; reverse?: boolean; onData: (data: Evidence) => boolean }): Promise<void> {
    const fromheight = from ? from : new BN(0);
    const toheight = to ? to : new BN(99999);
    const filtered = this.pendingEvidence.filter((ev) => ev.height.gte(fromheight) && ev.height.lte(toheight));
    filtered.sort((a, b) => {
      if (reverse) {
        const middle = b;
        b = a;
        a = middle;
      }
      if (a.height.eq(b.height)) {
        const factorA = new BN(a.hash()).toNumber();
        const factorB = new BN(b.hash()).toNumber();
        return factorA - factorB;
      } else {
        return a.height.sub(b.height).toNumber();
      }
    });
    let index = filtered.length;
    const filteredNum = filtered.length;
    while (index > 0 && !onData(filtered[filteredNum - index])) {
      index--;
    }
    return new Promise<void>((resolve) => {
      resolve();
    });
  }
}

class evTest implements Evidence {
  height: BN;
  factor: BN;
  constructor(height: BN, factor: BN) {
    this.height = height;
    this.factor = factor;
  }

  raw() {
    return [toBuffer(this.height), toBuffer(this.factor)];
  }

  hash(): Buffer {
    return toBuffer(this.factor);
  }

  serialize(): Buffer {
    return toBuffer(this.height);
  }

  validateBasic(): void {}
}

describe('evpool', () => {
  const testbd = new testBackend();
  const evpool = new EvidencePool(testbd, evpoolMaxCacheSize, evpoolMaxAgeNumBlocks);
  before(async () => {
    await evpool.init(new BN(0));
    for (let i = 0; i < abortHeight; i++) {
      for (let j = 0; j < aborttime; j++) {
        await evpool.addEvidence(new evTest(new BN(i), new BN(j)));
      }
    }
  });

  it('should get pendingEvidence correctly', () => {
    expect(evpool.pendingEvidence.length, 'evidence number shoule be euqal').be.equal(abortHeight * aborttime);
  });

  it('should add Evidence correctly', async () => {
    const evToAdd = new evTest(new BN(addHeight), new BN(0));
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
    await evpool.addEvidence(new evTest(new BN(addHeight), new BN(0)));
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
