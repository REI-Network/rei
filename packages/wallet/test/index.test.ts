import fs from 'fs';
import path from 'path';
import Wallet from 'ethereumjs-wallet';
import { expect } from 'chai';
import { hexStringToBuffer } from '../../utils';
import { AccountManager } from '../src/index';
import { KeyStore, keyStoreFileName } from '../src/keystore';
import { Address } from 'ethereumjs-util';

describe('AccountManager', () => {
  let testdir: string;
  let testdir2: string;
  let accountManager: AccountManager;
  let addressArr: Buffer[] = [];
  let keystore: KeyStore;
  const passphrase = 'password';
  const newpassphrase = 'newpassphrase';

  before(async () => {
    testdir = path.join(__dirname, './test-dir');
    testdir2 = path.join(__dirname, './test-dir2');
    fs.rmSync(testdir, { recursive: true, force: true });
    fs.mkdirSync(testdir, { recursive: true });
    fs.rmSync(testdir2, { recursive: true, force: true });
    fs.mkdirSync(testdir2, { recursive: true });
    accountManager = new AccountManager(testdir);
    keystore = new KeyStore(testdir2);
  });

  it('should new accounts and get totalAccounts', async () => {
    let i = 3;
    while (i > 0) {
      const result = await accountManager.newAccount(passphrase);
      addressArr.push(hexStringToBuffer(result.address));
      i--;
    }
    addressArr.sort((a, b) => {
      return a.compare(b);
    });
    accountManager.totalAccounts().forEach((element, i) => {
      expect(element.addrBuf.equals(addressArr[i]), 'address buffer should be euqal').be.true;
    });
  });

  it('should has address', () => {
    addressArr.forEach((element) => {
      expect(accountManager.hasAccount(element), 'should has address').be.true;
    });
  });

  it('should unlock account', async () => {
    expect(await accountManager.unlock(addressArr[0], passphrase), 'unlock should true').be.true;
    expect(await accountManager.unlock(addressArr[1], passphrase), 'unlock should true').be.true;
  });

  it('should get unlocked accounts', () => {
    expect(accountManager.totalUnlockedAccounts().length, 'should get unlocked accounts').be.equal(2);
  });

  it('should has unlock address', () => {
    expect(accountManager.hasUnlockedAccount(addressArr[0]), 'should has unlock address').be.true;
  });

  it('should lock account', () => {
    accountManager.lock(addressArr[0]);
    expect(accountManager.hasUnlockedAccount(addressArr[0]), 'should not be unlocked').be.false;
  });

  it('should get privatekey', () => {
    const privatekey = accountManager.getPrivateKey(addressArr[1]);
    const address = Address.fromPrivateKey(privatekey);
    expect(address.buf.equals(addressArr[1]), 'address should be equal').be.true;
  });

  it('should importKey correctly', async () => {
    const wallet = Wallet.generate();
    const address = wallet.getAddressString();
    const privateKey = wallet.getPrivateKeyString();
    const localpath = path.join(testdir2, keyStoreFileName(address));
    await keystore.storeKey(localpath, privateKey, passphrase);
    const address2 = await accountManager.importKey(localpath, passphrase);
    expect(address2, 'address should be equal').be.equal(address);
    expect(accountManager.hasAccount(address2), 'account manager should has the address').be.true;
  });

  it('should importKeyByPrivateKey correctly', async () => {
    const wallet = Wallet.generate();
    const address = wallet.getAddressString();
    const privateKey = wallet.getPrivateKeyString();
    const address2 = await accountManager.importKeyByPrivateKey(privateKey, passphrase);
    expect(address2, 'address should be equal').be.equal(address);
    expect(accountManager.hasAccount(address2), 'account manager should has the address').be.true;
  });

  it('should update account', async () => {
    await accountManager.update(addressArr[2], passphrase, newpassphrase);
    expect(accountManager.hasUnlockedAccount(addressArr[2]), 'should not be unlocked').be.false;
    await accountManager.unlock(addressArr[2], newpassphrase);
    expect(accountManager.hasUnlockedAccount(addressArr[2]), 'should be unlocked').be.true;
  });

  after(() => {
    fs.rmSync(testdir, { recursive: true, force: true });
    fs.rmSync(testdir2, { recursive: true, force: true });
  });
});
