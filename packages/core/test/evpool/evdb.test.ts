import * as fs from 'fs/promises';
import path from 'path';
import { expect } from 'chai';
import { BN } from 'ethereumjs-util';
import { LevelUp } from 'levelup';
import { createLevelDB } from '@rei-network/database';
import { EvidenceDatabase, Evidence } from '../../src/reimint/evpool';
import { MockEvidence } from './mockEvidence';

describe('EvidenceDatabase', () => {
  const testDir = path.join(__dirname, 'test-dir');
  let rawdb: LevelUp;
  let db: EvidenceDatabase;

  const clearup = async () => {
    try {
      await fs.access(testDir);
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (err) {
      // ignore all errors
    }
  };

  before(async () => {
    await clearup();
    [rawdb] = createLevelDB(testDir);
    db = new EvidenceDatabase(rawdb);
  });

  it('should write successfully(1)', async () => {
    for (let i = 0; i < 5; i++) {
      await db.addPendingEvidence(new MockEvidence(new BN(100 + i)));
    }
  });

  it('should load and remove successfully', async () => {
    const evList: Evidence[] = [];
    await db.loadPendingEvidence({
      from: new BN(0),
      onData: async (ev) => {
        evList.push(ev);
        await db.removePendingEvidence(ev);
        return false;
      }
    });

    expect(evList.length).be.equal(5);
    for (let i = 0; i < 5; i++) {
      expect(evList[i].height.toNumber()).be.equal(100 + i);
    }
  });

  it('should load successfully', async () => {
    const evList: Evidence[] = [];
    await db.loadPendingEvidence({
      from: new BN(0),
      onData: async (ev) => {
        evList.push(ev);
        return false;
      }
    });

    expect(evList.length).be.equal(0);
  });

  const uint64Max = new BN('ffffffffffffffff', 'hex');
  it('should write successfully(2)', async () => {
    await db.addPendingEvidence(new MockEvidence(new BN(1111112345)));
    await db.addPendingEvidence(new MockEvidence(new BN(0)));
    await db.addPendingEvidence(new MockEvidence(new BN(12345)));
    await db.addPendingEvidence(new MockEvidence(uint64Max));

    await db.addCommittedEvidence(new MockEvidence(new BN(11231231)));
  });

  it('should load successfully(reverse)', async () => {
    const evList: Evidence[] = [];
    await db.loadPendingEvidence({
      to: uint64Max,
      from: new BN(0),
      reverse: true,
      onData: async (ev) => {
        evList.push(ev);
        return false;
      }
    });

    expect(evList.length).be.equal(4);
    expect(evList[0].height.toString()).be.equal(uint64Max.toString());
    expect(evList[1].height.toNumber()).be.equal(1111112345);
    expect(evList[2].height.toNumber()).be.equal(12345);
    expect(evList[3].height.toNumber()).be.equal(0);
  });

  it('should check successfully', async () => {
    expect(await db.isPending(new MockEvidence(new BN(0)))).be.true;
    expect(await db.isPending(new MockEvidence(new BN(11231231)))).be.false;
    expect(await db.isCommitted(new MockEvidence(new BN(11231231)))).be.true;
  });

  after(async () => {
    await rawdb.close();
    await clearup();
  });
});
