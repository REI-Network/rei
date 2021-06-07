import path from 'path';
import { Address, keccak256, hashPersonalMessage } from 'ethereumjs-util';
import { FunctionalMap, createBufferFunctionalMap } from '@gxchain2/utils';
import { AccountCache } from './accountcache';
import { KeyStore } from './keystore';
import { create } from './account';
import { Accountinfo } from './types';

type AddrType = Address | string | Buffer;

export class AccountManger {
  storage: KeyStore;
  cache: AccountCache;
  unlocked: FunctionalMap<Buffer, string>;

  constructor(keydir: string) {
    if (!path.isAbsolute(keydir)) {
      keydir = path.join(process.cwd(), keydir);
    }
    this.storage = new KeyStore(keydir);
    this.unlocked = createBufferFunctionalMap<string>();
    this.cache = new AccountCache(keydir);
    this.cache.accounts();
  }

  getDecryptedKey(a: AddrType, auth: string): [Accountinfo, any] {
    this.cache.accounts();
    const ai = this.cache.get(addrToBuffer(a));
    if (!ai) {
      throw new Error('unknown account');
    }
    const key = this.storage.getKey(ai.address, ai.path, auth);
    return [ai, key];
  }

  importKey(key: { address: string; privateKey: string }, passphrase: string) {
    const addr = Address.fromString(key.address);
    const a: Accountinfo = { address: addr, path: path.join(this.storage.joinPath(keyFileName(addr))) };
    this.storage.storeKey(a.path, key, passphrase);
    this.cache.add(a);
    return a;
  }

  update(a: AddrType, passphrase: string, newpassphrase: string) {
    const [account, key] = this.getDecryptedKey(a, passphrase);
    return this.storage.storeKey(account.path, key, newpassphrase);
  }

  newAccount(passphrase: string) {
    const key = create();
    const addr = Address.fromString(key.address);
    const account: Accountinfo = { address: addr, path: this.storage.joinPath(keyFileName(addr)) };
    this.storage.storeKey(account.path, key, passphrase);
    this.cache.add(account);
    return account;
  }

  lock(addr: Address) {
    this.unlocked.delete(addr.toBuffer());
  }

  unlock(addr: AddrType, passphrase: string) {
    const buf = addrToBuffer(addr);
    if (!this.unlocked.has(buf)) {
      const [account, key] = this.getDecryptedKey(addr, passphrase);
      this.unlocked.set(buf, key);
    }
  }
}

export function keyFileName(keyAddr: Address): string {
  const ts = new Date();
  const utc = new Date(ts.getTime() + ts.getTimezoneOffset() * 60000);
  const format = utc.toISOString().replace(/:/g, '-');
  return 'UTC--' + format + '--' + keyAddr.toString();
}

function addrToBuffer(addr: AddrType) {
  if (!Buffer.isBuffer(addr)) {
    addr = typeof addr === 'object' ? addr.toBuffer() : Address.fromString(addr).toBuffer();
  }
  return addr;
}
