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
  const nodedb = new NodeDB(db);
  const { enr: localEnr, keypair: localKeyPair } = await newEnr();

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
    const { enr, keypair } = await newEnr();
    const content: Array<ENRKey | ENRValue | number> = Array.from(enr.keys())
      .sort((a, b) => a.localeCompare(b))
      .map((k) => [k, enr.get(k)] as [ENRKey, ENRValue])
      .flat();
    content.unshift(Number(enr.seq));
    enr.sign(RLP.encode(content), keypair.privateKey);
    await nodedb.persist(enr);
  });

  it('should be putReceived and get last pong timestamp', async () => {
    const { enr, keypair } = await newEnr();
    const content: Array<ENRKey | ENRValue | number> = Array.from(enr.keys())
      .sort((a, b) => a.localeCompare(b))
      .map((k) => [k, enr.get(k)] as [ENRKey, ENRValue])
      .flat();
    content.unshift(Number(enr.seq));
    enr.sign(RLP.encode(content), keypair.privateKey);
    await nodedb.persist(enr);
    const n = Date.now();
    await nodedb.putReceived(enr.nodeId, enr.ip!);
    expect(Math.ceil(n / 1000)).to.equal(Math.ceil((await nodedb.lastPongReceived(enr.nodeId, enr.ip!)) / 1000));
  });

  it.only('should be query seed', async () => {
    let promiseList: Promise<unknown>[] = [];
    for (let i = 0; i < 10; i++) {
      const { enr, keypair } = await newEnr();
      const content: Array<ENRKey | ENRValue | number> = Array.from(enr.keys())
        .sort((a, b) => a.localeCompare(b))
        .map((k) => [k, enr.get(k)] as [ENRKey, ENRValue])
        .flat();
      content.unshift(Number(enr.seq));
      enr.sign(RLP.encode(content), keypair.privateKey);
      await nodedb.persist(enr);
      const timer = new Promise((resolve) => {
        setTimeout(async () => {
          await nodedb.putReceived(enr.nodeId, enr.ip!);
          resolve(null);
        }, 1000 * i + 1);
      });
      promiseList.push(timer);
    }
    await Promise.all(promiseList);
    const result = await nodedb.querySeeds(10, 1000 * 1000);
    expect(result.length).to.equal(10);
  });
});

async function newEnr() {
  const keypair = createKeypairFromPeerId(await PeerId.create({ keyType: 'secp256k1' }));
  const enr = ENR.createV4(keypair.publicKey);
  enr.ip = '127.0.0.1';
  enr.tcp = 4191;
  enr.udp = 9810;
  return { enr, keypair };
}
