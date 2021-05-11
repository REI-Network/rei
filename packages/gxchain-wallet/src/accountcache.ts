import { Address } from 'ethereumjs-util';
import { Accountinfo } from './accountmanager';
import fs from 'fs';
import { FunctionalMap, createBufferFunctionalMap } from '@gxchain2/utils';
import { FileCache } from './filecache';

export class AccountCache {
  keydir: string;
  byAddr: FunctionalMap<Buffer, Accountinfo> = createBufferFunctionalMap<Accountinfo>();
  fileC: FileCache;
  constructor(keydir: string) {
    this.keydir = keydir;
    this.fileC = new FileCache();
  }

  accounts(): Accountinfo[] {
    this.scanAccounts();
    return Array.from(this.byAddr.values());
  }

  hasAddress(addr: Address): boolean {
    this.scanAccounts();
    return !!this.byAddr.get(addr.toBuffer());
  }

  add(newaccount: Accountinfo) {
    this.byAddr.set(newaccount.address.toBuffer(), newaccount);
  }

  delete(removed: Accountinfo) {
    this.byAddr.delete(removed.address.toBuffer());
  }

  deleteByFile(path: string) {
    const addr = Array.from(this.byAddr.values()).find((addr) => {
      addr.path === path;
    });
    if (addr) {
      this.byAddr.delete(addr.address.toBuffer());
    }
  }

  find(a: Accountinfo) {
    return this.byAddr.get(a.address.toBuffer());
  }

  scanAccounts() {
    const result = this.fileC.scan(this.keydir);
    if (!result) {
      return;
    }
    const [creates, deletes, updates] = result;

    if (creates.length === 0 && deletes.length === 0 && updates.length === 0) {
      return;
    }

    for (const fi of creates) {
      const a = this.readAccount(fi);
      if (a) {
        this.add(a);
      }
    }

    for (const fi of deletes) {
      this.deleteByFile(fi);
    }

    for (const fi of updates) {
      this.deleteByFile(fi);
      const a = this.readAccount(fi);
      if (a) {
        this.add(a);
      }
    }
  }

  private readAccount(path: string) {
    const keybuffer = fs.readFileSync(path);
    const keyjson = JSON.parse(keybuffer.toString());
    const addrstring = keyjson.address;
    const addr = Address.fromString('0x' + addrstring);
    const account: Accountinfo = { address: addr, path: path };
    return account;
  }
}
