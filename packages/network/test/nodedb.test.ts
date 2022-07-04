import { expect } from 'chai';
import path from 'path';
import levelup from 'levelup';
import PeerId from 'peer-id';
import { NodeDB } from '../src/nodedb';
import { leveldown } from '@rei-network/binding';
import { ENR, ENRKey, ENRValue } from '@gxchain2/discv5';
import { createKeypairFromPeerId } from '@gxchain2/discv5/lib/keypair';
import * as RLP from 'rlp';
describe('NodeDB', async () => {
  const db = levelup(leveldown(path.join(__dirname, './database')) as any, { manifestFileMaxSize: 64 * 1024 * 1024 });
  let nodedb = new NodeDB(db);
  const { enr: localEnr } = await newEnr();

  beforeEach(() => {
    db.clear();
    nodedb = new NodeDB(db);
  });

  it('should be able to add local seq', async () => {
    await nodedb.storeLocalSeq(localEnr.nodeId, localEnr.seq);
    const seq = await nodedb.localSeq(localEnr.nodeId);
    expect(seq).to.equal(localEnr.seq);
    localEnr.seq = BigInt(Date.now());
    await nodedb.storeLocalSeq(localEnr.nodeId, localEnr.seq);
    const seq2 = await nodedb.localSeq(localEnr.nodeId);
    expect(seq2).to.equal(localEnr.seq);
  });

  it('should be able to persist', async () => {
    const { enr } = await newEnr();
    await nodedb.persist(enr);
  });

  it('should be putReceived and get last pong timestamp', async () => {
    const { enr } = await newEnr();
    await nodedb.persist(enr);
    const n = Date.now();
    await nodedb.putReceived(enr.nodeId, enr.ip!);
    expect(Math.ceil(n / 1000)).to.equal(Math.ceil((await nodedb.lastPongReceived(enr.nodeId, enr.ip!)) / 1000));
  });

  it('should be query seed', async () => {
    const enrList: ENR[] = [];
    const maxAge = 5 * 1000;
    for (let i = 0; i < 100; i++) {
      const { enr } = await newEnr();
      await nodedb.persist(enr);
      await nodedb.putReceived(enr.nodeId, enr.ip!);
      enrList.push(enr);
    }
    await new Promise((r) => setTimeout(r, 10 * 1000));
    for (let i = 0; i < 50; i++) {
      const enr = enrList[i];
      await nodedb.putReceived(enr.nodeId, enr.ip!);
    }
    const now = Date.now();
    const result = await nodedb.querySeeds(10, maxAge);
    for (let i = 0; i < result.length; i++) {
      const time = await nodedb.lastPongReceived(result[i].nodeId, result[i].ip!);
      if (now - time > maxAge) {
        expect(1).to.equal(0);
      }
      for (let n = 0; n < result.length; n++) {
        if (result[i].nodeId == result[n].nodeId && i != n) {
          expect(2).to.equal(0);
        }
      }
    }
    expect(result.length).to.equal(10);
  });

  it('should be check time out entry', async () => {
    const enrList: ENR[] = [];
    for (let i = 0; i < 100; i++) {
      const { enr } = await newEnr();
      await nodedb.persist(enr);
      await nodedb.putReceived(enr.nodeId, enr.ip!);
      enrList.push(enr);
    }
    await new Promise((r) => setTimeout(r, 10 * 1000));
    await nodedb.checkTimeout(5 * 1000);
    const result = await nodedb.querySeeds(100, 100 * 1000);
    expect(result.length).to.equal(0);
  });
});

async function newEnr() {
  const keypair = createKeypairFromPeerId(await PeerId.create({ keyType: 'secp256k1' }));
  const enr = ENR.createV4(keypair.publicKey);
  enr.ip = '127.0.0.1';
  enr.tcp = 4191;
  enr.udp = 9810;
  const content: Array<ENRKey | ENRValue | number> = Array.from(enr.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((k) => [k, enr.get(k)] as [ENRKey, ENRValue])
    .flat();
  content.unshift(Number(enr.seq));
  enr.sign(RLP.encode(content), keypair.privateKey);
  return { enr, keypair };
}

async function sleep(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}
