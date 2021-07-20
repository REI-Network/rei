import fs from 'fs';
import path from 'path';
import Wallet from 'ethereumjs-wallet';
import { expect } from 'chai';
import { KeyStore, keyStoreFileName } from '../src/keystore';

describe('Keystore', () => {
  let testdir: string;
  let wallet: Wallet;
  let address: string;
  let privateKey: string;
  let keystore: KeyStore;
  let localPath: string;
  const passphrase = 'password';

  before(async () => {
    wallet = Wallet.generate();
    address = wallet.getAddressString();
    privateKey = wallet.getPrivateKeyString();
    testdir = path.join(__dirname, './test-dir');
    if (!fs.existsSync(testdir)) {
      fs.mkdirSync(testdir, { recursive: true });
    }
    keystore = new KeyStore(testdir);
    localPath = keystore.joinPath(keyStoreFileName(address));
  });

  it('should store key', async () => {
    const files1 = fs.readdirSync(testdir).filter((item) => !/(^|\/)\.[^\/\.]/g.test(item));
    expect(files1.length, 'keystore should be empty').be.equal(0);
    await keystore.storeKey(localPath, privateKey, passphrase);
    const files2 = fs.readdirSync(testdir).filter((item) => !/(^|\/)\.[^\/\.]/g.test(item));
    expect(files2.length, 'keystore should not be empty').be.equal(1);
  });

  it('should get key', async () => {
    const keyobject = await keystore.getKey(localPath, passphrase);
    expect(keyobject.address, 'address should he euqal').be.equal(address);
    expect(keyobject.privateKey, 'privateKey should he euqal').be.equal(privateKey);
  });

  after(() => {
    fs.rmdirSync(testdir, { recursive: true });
  });
});
