import { Address, keccak256, hashPersonalMessage } from 'ethereumjs-util';
import { AccountCache } from './accountcache';
import { Transaction } from '@ethereumjs/tx';
import { FunctionalMap, createBufferFunctionalMap } from '@gxchain2/utils';
import path from 'path';
import { KeyStorePassphrase } from './passphrase';
import { sign, create } from './account';
type AddrType = Address | string | Buffer;

export type Accountinfo = {
  address: Address;
  path: string;
};

export class AccountManger {
  storage: KeyStorePassphrase;
  cache: AccountCache;
  unlocked: FunctionalMap<Buffer, string>;

  constructor(keydir: string) {
    if (!path.isAbsolute(keydir)) {
      keydir = path.join(process.cwd(), keydir);
    }
    this.storage = new KeyStorePassphrase(keydir);
    this.unlocked = createBufferFunctionalMap<string>();
    this.cache = new AccountCache(keydir);
  }

  getDecryptedKey(a: AddrType, auth: string) {
    this.cache.accounts();
    const accountinfo = this.cache.byAddr.get(dealAddrToBuffer(a));
    if (!accountinfo) {
      throw new Error('unknown account');
    }
    const key = this.storage.getkey(accountinfo.address, accountinfo.path, auth);
    return [accountinfo, key];
  }

  signHash(a: AddrType, hash: Buffer) {
    const unlockedKey = this.unlocked.get(dealAddrToBuffer(a));
    if (!unlockedKey) {
      throw new Error('password is wrong or unlock');
    }
    return sign(hash.toString(), unlockedKey);
  }

  signHashWithPassphrase(a: AddrType, passphrase: string, hash: Buffer) {
    const [account, key] = this.getDecryptedKey(a, passphrase);
    return sign(hash.toString(), key.privateKeyb);
  }

  signTx(a: AddrType, tx: Transaction) {
    const unlockedKey = this.unlocked.get(dealAddrToBuffer(a));
    if (!unlockedKey) {
      throw new Error('password is wrong or unlock');
    }
    return tx.sign(Buffer.from(unlockedKey));
  }

  signTxWithPassphrase(a: AddrType, passphrase: string, tx: Transaction) {
    const [account, key] = this.getDecryptedKey(a, passphrase);
    return tx.sign(Buffer.from(key.privateKey));
  }

  signData(addr: AddrType, mimeType: string, data: Buffer) {
    return this.signHash(addr, keccak256(data));
  }

  signDataWithPassphrase(addr: AddrType, passphrase, data: Buffer) {
    return this.signHashWithPassphrase(addr, passphrase, keccak256(data));
  }

  signText(addr: AddrType, text: Buffer) {
    return this.signHash(addr, hashPersonalMessage(text));
  }

  signTextWithPassphrase(addr: AddrType, passphrase: string, text: Buffer) {
    return this.signHashWithPassphrase(addr, passphrase, hashPersonalMessage(text));
  }

  importKey(key: { address: string; privateKey: string }, passphrase: string) {
    const addr = Address.fromString(key.address);
    const a: Accountinfo = { address: addr, path: path.join(this.storage.joinPath(keyFileName(addr))) };
    this.storage.storekey(a.path, key, passphrase);
    this.cache.add(a);
    return a;
  }

  update(a: AddrType, passphrase: string, newpassphrase: string) {
    const [account, key] = this.getDecryptedKey(a, passphrase);
    return this.storage.storekey(account.path, key, newpassphrase);
  }

  newaccount(passphrase: string) {
    const key = create();
    const addr = Address.fromString(key.address);
    const account: Accountinfo = { address: addr, path: this.storage.joinPath(keyFileName(addr)) };
    this.storage.storekey(account.path, key, passphrase);
    this.cache.add(account);
    return account;
  }

  lock(addr: Address) {
    const account = this.unlocked.get(addr.toBuffer());
    if (account) {
      this.unlocked.delete(addr.toBuffer());
    }
  }

  unlock(a: AddrType, passphrase: string) {
    const [account, key] = this.getDecryptedKey(a, passphrase);
    if (this.unlocked.get(account.address.toBuffer())) {
      return;
    }
    this.unlocked.set(dealAddrToBuffer(a), key);
  }
}

export function keyFileName(keyAddr: Address): string {
  const ts = new Date();
  const utc = new Date(ts.getTime() + ts.getTimezoneOffset() * 60000);
  const format = utc.toISOString().replace(/:/g, '-');
  return 'UTC--' + format + '--' + keyAddr.toString();
}

function dealAddrToBuffer(addr: AddrType) {
  if (Buffer.isBuffer(addr)) {
    addr = Address.fromPublicKey(addr).toBuffer();
  } else {
    addr = typeof addr === 'object' ? addr.toBuffer() : Address.fromString(addr).toBuffer();
  }
  return addr;
}
