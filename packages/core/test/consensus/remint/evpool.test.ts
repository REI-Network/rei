import { expect } from 'chai';
import { BN } from 'ethereumjs-util';
import { Vote } from '../../../src/consensus/reimint/types/vote';
import { Evidence, DuplicateVoteEvidence } from '../../../src/consensus/reimint/types/evidence';
import { EvidencePool, EvidencePoolBackend } from '../../../src/consensus/reimint/types/evpool';

const evpoolMaxCacheSize = 40;
const evpoolMaxAgeNumBlocks = new BN(5);
const endHeight = 11;
const evNumberPerHeight = 3;

function randomBuffer(bufferLength: number) {
  let sampleString = 'abcdefhijkmnprstwxyz2345678';
  let result = '';
  for (let i = 0; i < bufferLength; i++) {
    result += sampleString.charAt(Math.floor(Math.random() * sampleString.length));
  }
  return Buffer.from(result);
}

const createEvidence = (height: BN) => {
  const voteA = new Vote({ chainId: 1, type: 1, height: height, round: 1, hash: randomBuffer(32), timestamp: Date.now(), index: 1 });
  voteA.sign(randomBuffer(32));
  return new DuplicateVoteEvidence(voteA, voteA, height);
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
    for (let i = 0; i < endHeight; i++) {
      for (let j = 0; j < evNumberPerHeight; j++) {
        await evpool.addEvidence(createEvidence(new BN(i)));
      }
    }
  });

  it('should get pendingEvidence correctly', () => {
    expect(evpool.pendingEvidence.length, 'evidence number shoule be euqal').be.equal(endHeight * evNumberPerHeight);
  });

  it('should add Evidence correctly', async () => {
    const evToAdd = createEvidence(new BN(endHeight + 1));
    await evpool.addEvidence(evToAdd);
    expect(evpool.pendingEvidence.length, 'evidence number shoule be euqal').be.equal(endHeight * evNumberPerHeight + 1);
    const evCache = evpool.pendingEvidence[evpool.pendingEvidence.length - 1];
    let evdatabase: Evidence[] = [];
    await testbd.loadPendingEvidence({
      reverse: true,
      onData: (ev) => {
        evdatabase.push(ev);
        return true;
      }
    });
    expect(evCache.hash().equals(evToAdd.hash()), 'should add Evidence into Cache correctly').be.true;
    expect(evdatabase[0].hash().equals(evToAdd.hash()), 'should add Evidence into Database correctly').be.true;
  });

  it('should pickEvidence correctly', async () => {
    const height = new BN(3);
    const evNumber = 3 * evNumberPerHeight;
    const result = await evpool.pickEvidence(height, evNumber);
    expect(result.length === evNumber, 'pickEvidence number should correct').be.true;
    expect(result[result.length - 1].height.eq(height.subn(1)), 'pickEvidence height should correct').be.true;
  });

  it('should checkeEvidence correctly', async () => {
    const evList = await evpool.pickEvidence(new BN(3), 3 * evNumberPerHeight);
    expect(await evpool.checkEvidence(evList), 'checkEvidence should be true').be.true;
    evList[0] = evList[1];
    expect(await evpool.checkEvidence(evList), 'checkEvidence should be false').be.false;
  });

  it('should update correctly', async () => {
    const numberPick = 2 * evNumberPerHeight;
    const heightPick = new BN(2);
    const heightUpdate1 = heightPick;
    const heightUpdate2 = new BN(9);
    const evList = await evpool.pickEvidence(heightPick, numberPick);

    const committedLengthBeforeUpdate1 = testbd.committedEvidence.length;
    const pendingLengtgBeforeUpdate1 = testbd.pendingEvidence.length;
    const cachedPendingLengtgBeforeUpdate1 = evpool.pendingEvidence.length;
    await evpool.update(evList, heightUpdate1);
    const committedLengthAfterUpdate1 = testbd.committedEvidence.length;
    const pendingLengtgAfterUpdate1 = testbd.pendingEvidence.length;
    const cachedPendingLengtgAfterUpdate1 = evpool.pendingEvidence.length;
    expect(committedLengthAfterUpdate1 - committedLengthBeforeUpdate1 === evList.length, 'After update1 the committed evidences should be correct').be.true;
    expect(pendingLengtgBeforeUpdate1 - pendingLengtgAfterUpdate1 === evList.length, 'After update1 the pending evidences should be correct').be.true;
    expect(cachedPendingLengtgBeforeUpdate1 - cachedPendingLengtgAfterUpdate1 === evList.length, 'After update1 the pending evidences should be correct').be.true;

    await evpool.update(evList, heightUpdate2);
    const committedLengthAfterUpdate2 = testbd.committedEvidence.length;
    const pendingLengtgAfterUpdate2 = testbd.pendingEvidence.length;
    const cachedPendingLengtgAfterUpdate2 = evpool.pendingEvidence.length;
    expect(committedLengthAfterUpdate2 - committedLengthAfterUpdate1 === 0, 'After update2 the committed evidences should be correct').be.true;
    expect(pendingLengtgAfterUpdate1 - pendingLengtgAfterUpdate2 === (heightUpdate2.sub(heightUpdate1).toNumber() - evpoolMaxAgeNumBlocks.toNumber() + 1) * evNumberPerHeight, 'After update2 the pending evidences should be correct').be.true;
    expect(cachedPendingLengtgAfterUpdate1 - cachedPendingLengtgAfterUpdate2 === (heightUpdate2.sub(heightUpdate1).toNumber() - evpoolMaxAgeNumBlocks.toNumber() + 1) * evNumberPerHeight, 'After update1 the pending evidences should be correct').be.true;
  });
});
