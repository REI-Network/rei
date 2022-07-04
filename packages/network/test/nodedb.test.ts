import levelup from 'levelup';
import PeerId from 'peer-id';
import { expect, assert } from 'chai';
import { ENR } from '@gxchain2/discv5';
import { createKeypairFromPeerId } from '@gxchain2/discv5/lib/keypair';
import { NodeDB } from '../src/nodedb';
const memdown = require('memdown');

describe('NodeDB', async () => {
  let nodedb: NodeDB;
  const db = levelup(memdown());
  const localEnr = await newEnr();

  beforeEach(async () => {
    await db.clear();
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
    const enr = await newEnr();
    await nodedb.persist(enr);
  });

  it('should be update pong message succeed and get last pong timestamp', async () => {
    const enr = await newEnr();
    await nodedb.persist(enr);
    const n = Date.now();
    await nodedb.updatePongMessage(enr.nodeId, enr.ip!, n);
    expect(n).to.equal(await nodedb.lastPongReceived(enr.nodeId, enr.ip!));
  });

  it('should be query seed nodes succeed', async () => {
    const enrList: ENR[] = [];
    const maxAge = 50 * 1000;
    for (let i = 0; i < 100; i++) {
      const enr = await newEnr();
      await nodedb.persist(enr);
      await nodedb.updatePongMessage(enr.nodeId, enr.ip!, Date.now() - i * 1000);
      enrList.push(enr);
    }
    const now = Date.now();
    const result = await nodedb.querySeeds(10, maxAge);
    for (let i = 0; i < result.length; i++) {
      const time = await nodedb.lastPongReceived(result[i].nodeId, result[i].ip!);
      if (now - time > maxAge) {
        assert('should not be in the result');
      }
      for (let n = 0; n < result.length; n++) {
        if (result[i].nodeId === result[n].nodeId && i !== n) {
          assert('should not be in the result');
        }
      }
    }
    expect(result.length).to.equal(10);
  });

  it('should be able to delete expired node data', async () => {
    const enrList: ENR[] = [];
    for (let i = 0; i < 100; i++) {
      const enr = await newEnr();
      await nodedb.persist(enr);
      await nodedb.updatePongMessage(enr.nodeId, enr.ip!, Date.now() - 10 * 1000);
      enrList.push(enr);
    }
    await nodedb.checkTimeout(5 * 1000);
    for (let i = 0; i < enrList.length; i++) {
      try {
        await db.get(nodedb.nodeKey(enrList[i]));
      } catch (error) {
        expect((error as any).type).to.equal('NotFoundError');
      }
      try {
        await db.get(nodedb.nodeItemKey(enrList[i], 'lastPong'));
      } catch (error) {
        expect((error as any).type).to.equal('NotFoundError');
      }
    }
  });
});

async function newEnr() {
  const keypair = createKeypairFromPeerId(await PeerId.create({ keyType: 'secp256k1' }));
  const enr = ENR.createV4(keypair.publicKey);
  enr.ip = '127.0.0.1';
  enr.tcp = 4191;
  enr.udp = 9810;
  enr.encodeToValues(keypair.privateKey);
  return enr;
}
