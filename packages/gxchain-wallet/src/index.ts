import path from 'path';
import { Address } from 'ethereumjs-util';
import { createBufferFunctionalMap, hexStringToBuffer } from '@gxchain2/utils';
import { AccountCache } from './accountcache';
import { KeyStore, keyStoreFileName } from './keystore';
import { create } from './account';

type AddrType = Address | string | Buffer;

export class AccountManager {
  private storage: KeyStore;
  private cache: AccountCache;
  private unlocked = createBufferFunctionalMap<string>();

  constructor(keydir: string) {
    if (!path.isAbsolute(keydir)) {
      keydir = path.join(process.cwd(), keydir);
    }
    this.storage = new KeyStore(keydir);
    this.cache = new AccountCache(keydir);
    this.cache.accounts();
  }

  private getDecryptedKey(addr: AddrType, auth: string) {
    this.cache.accounts();
    const path = this.cache.get(addrToBuffer(addr));
    if (!path) {
      throw new Error('unknown account');
    }
    return { ...this.storage.getKey(path, auth), path };
  }

  totalAccounts() {
    return this.cache.accounts();
  }

  hasAccount(addr: AddrType) {
    return this.cache.has(addrToBuffer(addr));
  }

  importKey(path: string, passphrase: string) {
    const { address, privateKey } = this.storage.getKey(path, passphrase);
    const localPath = this.storage.joinPath(keyStoreFileName(address));
    this.storage.storeKey(localPath, privateKey, passphrase);
    this.cache.add(addrToBuffer(address), localPath);
    return address;
  }

  importKeyByPrivateKey(privateKey: string, passphrase: string) {
    const address = Address.fromPrivateKey(hexStringToBuffer(privateKey)).toString();
    const localPath = this.storage.joinPath(keyStoreFileName(address));
    this.storage.storeKey(localPath, privateKey, passphrase);
    this.cache.add(addrToBuffer(address), localPath);
    return address;
  }

  update(addr: AddrType, passphrase: string, newPassphrase: string) {
    const { privateKey, path } = this.getDecryptedKey(addr, passphrase);
    this.storage.storeKey(path, privateKey, newPassphrase);
  }

  newAccount(passphrase: string) {
    const { address, privateKey }: { address: string; privateKey: string } = create();
    const localPath = this.storage.joinPath(keyStoreFileName(address));
    this.storage.storeKey(localPath, privateKey, passphrase);
    this.cache.add(addrToBuffer(address), localPath);
    return { address, path: localPath };
  }

  lock(addr: AddrType) {
    this.unlocked.delete(addrToBuffer(addr));
  }

  unlock(addr: AddrType, passphrase: string) {
    const buf = addrToBuffer(addr);
    if (!this.unlocked.has(buf)) {
      const { privateKey } = this.getDecryptedKey(addr, passphrase);
      this.unlocked.set(buf, privateKey);
      return true;
    }
    return false;
  }
}

function addrToBuffer(addr: AddrType) {
  if (!Buffer.isBuffer(addr)) {
    addr = typeof addr === 'object' ? addr.toBuffer() : hexStringToBuffer(addr);
  }
  return addr;
}
