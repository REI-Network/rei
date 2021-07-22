import fs from 'fs';
import path from 'path';
import Wallet from 'ethereumjs-wallet';
import { hexStringToBuffer } from '../../utils';
import { expect } from 'chai';
import { KeyStore, keyStoreFileName } from '../src/keystore';
import { AccountCache } from '../src/accountcache';

describe('Accountcache', () => {
  let testdir: string;
  let keystore: KeyStore;
  let accountcache: AccountCache;
  const passphrase = 'password';
  const addressArr: Buffer[] = [];
  const pathArr: string[] = [];

  before(async () => {
    testdir = path.join(__dirname, './test-dir');
    fs.rmdirSync(testdir, { recursive: true });
    fs.mkdirSync(testdir, { recursive: true });
    keystore = new KeyStore(testdir);
    let i = 3;
    while (i > 0) {
      const wallet = Wallet.generate();
      const address = wallet.getAddressString();
      addressArr.push(hexStringToBuffer(address));
      const localPath = keystore.joinPath(keyStoreFileName(address));
      pathArr.push(localPath);
      const privateKey = wallet.getPrivateKeyString();
      await keystore.storeKey(localPath, privateKey, passphrase);
      i--;
    }
    accountcache = new AccountCache(testdir);
  });

  it('should get accounts', () => {
    const addressSorted = [...addressArr].sort((a, b) => {
      return a.compare(b);
    });
    const accounts = accountcache.accounts();
    accounts.forEach((element, i) => {
      expect(element.addrBuf.equals(addressSorted[i]), 'address should be equal').be.true;
    });
  });

  it('should has address', () => {
    addressArr.forEach((element) => {
      expect(accountcache.has(element), 'should has address').be.true;
    });
  });

  it('should get address information', () => {
    expect(accountcache.get(addressArr[0]), 'path should be equal').be.equal(pathArr[0]);
  });

  it('should add address correctly', () => {
    const wallet = Wallet.generate();
    const address = wallet.getAddressString();
    const localPath = keystore.joinPath(keyStoreFileName(address));
    accountcache.add(hexStringToBuffer(address), localPath);
    expect(accountcache.has(hexStringToBuffer(address)), 'should has address').be.true;
    expect(accountcache.get(hexStringToBuffer(address)), 'path should be equal').be.equal(localPath);
  });

  after(() => {
    fs.rmdirSync(testdir, { recursive: true });
  });
});
