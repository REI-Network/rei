import path from 'path';
import Wallet from 'ethereumjs-wallet';
import { Address, bufferToHex } from 'ethereumjs-util';
import { createBufferFunctionalMap, hexStringToBuffer } from '@gxchain2/utils';
import { AccountCache } from './accountcache';
import { KeyStore, keyStoreFileName } from './keystore';

type AddrType = Address | string | Buffer;

function addrToBuffer(addr: AddrType) {
  if (!Buffer.isBuffer(addr)) {
    addr = typeof addr === 'object' ? addr.toBuffer() : hexStringToBuffer(addr);
  }
  return addr;
}

function addrToString(addr: AddrType) {
  if (Buffer.isBuffer(addr)) {
    return bufferToHex(addr);
  } else if (addr instanceof Address) {
    return addr.toString();
  }
  return addr.startsWith('0x') ? addr : '0x' + addr;
}

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

  private async getDecryptedKey(addr: AddrType, passphrase: string) {
    this.cache.accounts();
    const path = this.cache.get(addrToBuffer(addr));
    if (!path) {
      throw new Error('unknown account');
    }
    return { ...(await this.storage.getKey(path, passphrase, addrToString(addr))), path };
  }

  totalAccounts() {
    return this.cache.accounts();
  }

  hasAccount(addr: AddrType) {
    return this.cache.has(addrToBuffer(addr));
  }

  async importKey(path: string, passphrase: string) {
    const { address, privateKey } = await this.storage.getKey(path, passphrase);
    const localPath = this.storage.joinPath(keyStoreFileName(address));
    await this.storage.storeKey(localPath, privateKey, passphrase);
    this.cache.add(addrToBuffer(address), localPath);
    return address;
  }

  async importKeyByPrivateKey(privateKey: string, passphrase: string) {
    const address = Address.fromPrivateKey(hexStringToBuffer(privateKey)).toString();
    const localPath = this.storage.joinPath(keyStoreFileName(address));
    await this.storage.storeKey(localPath, privateKey, passphrase);
    this.cache.add(addrToBuffer(address), localPath);
    return address;
  }

  async update(addr: AddrType, passphrase: string, newPassphrase: string) {
    const { privateKey, path } = await this.getDecryptedKey(addr, passphrase);
    await this.storage.storeKey(path, privateKey, newPassphrase);
  }

  async newAccount(passphrase: string) {
    const wallet = Wallet.generate();
    const address = wallet.getAddressString();
    const privateKey = wallet.getPrivateKeyString();
    const localPath = this.storage.joinPath(keyStoreFileName(address));
    await this.storage.storeKey(localPath, privateKey, passphrase);
    this.cache.add(addrToBuffer(address), localPath);
    return { address, path: localPath };
  }

  lock(addr: AddrType) {
    this.unlocked.delete(addrToBuffer(addr));
  }

  async unlock(addr: AddrType, passphrase: string) {
    const buf = addrToBuffer(addr);
    if (!this.unlocked.has(buf)) {
      const { privateKey } = await this.getDecryptedKey(addr, passphrase);
      this.unlocked.set(buf, privateKey);
      return true;
    }
    return false;
  }
}
