import crypto from 'crypto';
import { expect } from 'chai';
import { BN, bufferToHex } from 'ethereumjs-util';
import { getRandomIntInclusive } from '@rei-network/utils';
import { EvidenceCollector } from '../src/consensus/reimint/evidenceCollector';

describe('EvidenceCollector', () => {
  const evidence = new Map<number, Buffer[]>();
  const initHeight = 9;
  let initHashes: string[] = [];
  let collector!: EvidenceCollector;

  function hashesEqual(a: string[], b: string[]) {
    const setA = new Set(a);
    const setB = new Set(b);
    if (setA.size !== setB.size) {
      return false;
    }
    for (const v of setA) {
      if (!setB.has(v)) {
        return false;
      }
    }
    return true;
  }

  function noRepeat(arr: string[]) {
    const set = new Set(arr);
    return set.size === arr.length;
  }

  function toStringArray(hashes: Set<Buffer>) {
    return Array.from(hashes).map(bufferToHex);
  }

  function pick(from: number, to: number) {
    let hashes: Buffer[] = [];
    for (let i = from; i <= to; i++) {
      hashes = hashes.concat(evidence.get(i)!);
    }
    return hashes.map(bufferToHex);
  }

  async function load(height: BN) {
    if (!evidence.has(height.toNumber())) {
      throw new Error('missing header');
    }
    return evidence.get(height.toNumber())!;
  }

  beforeEach(() => {
    // generate init hashes
    for (let i = 0; i < 10; i++) {
      const count = getRandomIntInclusive(0, 3);
      const hashes: Buffer[] = [];
      for (let j = 0; j < count; j++) {
        const hash = crypto.randomBytes(32);
        hashes.push(hash);
        initHashes.push(bufferToHex(hash));
      }
      evidence.set(i, hashes);
    }
    // generate hashes
    for (let i = 0; i < 10; i++) {
      const count = getRandomIntInclusive(0, 3);
      const hashes: Buffer[] = [];
      for (let j = 0; j < count; j++) {
        const hash = crypto.randomBytes(32);
        hashes.push(hash);
      }
      evidence.set(i + 10, hashes);
    }
    collector = new EvidenceCollector(initHeight, initHashes);
  });

  afterEach(() => {
    evidence.clear();
    initHashes = [];
  });

  it('should init succeed(1)', async () => {
    await collector.init(new BN(5), load);
    expect(hashesEqual(toStringArray(collector.hashes), initHashes)).be.true;
  });

  it('should init succeed(2)', async () => {
    await collector.init(new BN(9), load);
    expect(hashesEqual(toStringArray(collector.hashes), initHashes)).be.true;
  });

  it('should init succeed(3)', async () => {
    await collector.init(new BN(15), load);
    expect(hashesEqual([...initHashes, ...pick(10, 15)], pick(0, 15))).be.true;
    expect(hashesEqual(toStringArray(collector.hashes), pick(0, 15))).be.true;
  });

  it('should add new evidence succeed(1)', async () => {
    await collector.init(new BN(5), load);
    for (let i = 6; i <= 19; i++) {
      const height = new BN(i);
      collector.newBlockHeader(height, await load(height));
    }
    expect(hashesEqual(toStringArray(collector.hashes), pick(0, 19))).be.true;
  });

  it('should add new evidence succeed(2)', async () => {
    await collector.init(new BN(11), load);
    for (let i = 12; i <= 19; i++) {
      const height = new BN(i);
      collector.newBlockHeader(height, await load(height));
    }
    expect(hashesEqual(toStringArray(collector.hashes), pick(0, 19))).be.true;
  });
});
