import fs from 'fs';
import path from 'path';
import { assert, expect } from 'chai';
import { BlsManager } from '../src/blsManager';
import { Bls } from '../src/types';

describe('BlsManager', () => {
  let testdir: string;
  let blsManager: BlsManager;
  const password = '123456';
  let blsPath1: string;
  let blsPath2: string;
  let publickey1: string;
  let publickey2: string;
  let bls: Bls;
  before(async () => {
    testdir = path.join(__dirname, './test-dir');
    fs.rmSync(testdir, { recursive: true, force: true });
    fs.mkdirSync(testdir, { recursive: true });
    blsManager = new BlsManager(testdir);
    bls = (await import('@chainsafe/bls')).default;
  });

  it('should new bls key successfully', async () => {
    const result = await blsManager.newSigner(password);
    blsPath1 = result.path;
    publickey1 = result.publickey;
    await blsManager.unlock(blsPath1, password);
    expect(blsManager.getPublicKey()!.toHex()).to.equal(
      publickey1,
      'public key should be equal'
    );
  });

  it('should update bls key successfully', async () => {
    const newPassword = '654321';
    await blsManager.updateSigner(blsPath1, password, newPassword);
    let failed = false;
    try {
      await blsManager.unlock(blsPath1, password);
      failed = true;
    } catch (error) {}
    if (failed) {
      assert.fail('unlock should failed case of wrong password');
    }

    await blsManager.unlock(blsPath1, newPassword);
    expect(blsManager.getPublicKey()!.toHex()).to.equal(
      publickey1,
      'public key should be equal'
    );
  });

  it('should import bls key successfully', async () => {
    const anotherPassword = 'anotherPassword';
    const secretKey =
      '0x4e51871f2256fcd0fc10f86fb378573fc56923362943ee5fc4a8c752af244610';
    const result = await blsManager.importSignerBySecretKey(
      secretKey,
      anotherPassword
    );
    blsPath2 = result.path;
    publickey2 = result.publickey;
    await blsManager.unlock(blsPath2, anotherPassword);
    expect(blsManager.getPublicKey()!.toHex()).to.equal(
      publickey2,
      'public key should be equal'
    );
  });

  it('should signMessage and verifySignature successfully', async () => {
    const message = 'reireirei';
    const signature = blsManager.signMessage(Buffer.from(message));
    const verifyResult = blsManager.verifyMessage(
      blsManager.getPublicKey()!.toBytes(),
      Buffer.from(message),
      signature.toBytes()
    );
    expect(verifyResult).to.equal(true, 'verify result should be true');
  });

  it('should aggregateSignatures and verifyAggregateSignature successfully', async () => {
    const messages = Array.from({ length: 10 }, () =>
      Buffer.from('reireirei' + Math.random())
    );
    const secretkeys = Array.from({ length: 10 }, () =>
      bls.SecretKey.fromKeygen()
    );
    const signatures = messages.map((m, index) =>
      secretkeys[index].sign(m).toBytes()
    );
    const aggregatedSignature = blsManager.aggregateSignatures(signatures);
    const verifyResult = blsManager.verifyMultiple(
      aggregatedSignature,
      messages,
      secretkeys.map((sk) => sk.toPublicKey().toBytes())
    );
    expect(verifyResult).to.equal(true, 'verify result should be true');
  });
});
