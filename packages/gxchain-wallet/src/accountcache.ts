import { Address } from 'ethereumjs-util';
import { Accountinfo } from './accounts';
import fs from 'fs';
import path from 'path';
import { FunctionalMap, createBufferFunctionalMap } from '@gxchain2/utils';
import { FileCache } from './filecache';

class Errexpand extends Error {
  accountinfo = {};
}

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
    const instance = this.byAddr.get(addr.toBuffer());
    if (instance) {
      return true;
    }
    return false;
  }

  add(newaccount: Accountinfo) {
    let instance = this.byAddr.get(newaccount.address.toBuffer());
    if (!instance) {
      this.byAddr.set(newaccount.address.toBuffer(), newaccount);
    }
  }

  delete(removed: Accountinfo) {
    let instance = this.byAddr.get(removed.address.toBuffer());
    this.byAddr.delete(removed.address.toBuffer());
  }

  deleteByFile(path: string) {
    let index = 0;
    const all = Array.from(this.byAddr.values());
    if (index < all.length && all[index].path === path) {
      const removed = all[index];
      const toremove = this.byAddr.get(removed.address.toBuffer());
      if (toremove) {
        this.byAddr.delete(toremove.address.toBuffer());
      }
    }
  }

  find(a: Accountinfo) {
    let matches = Array.from(this.byAddr.values());
    if (a.address != Address.zero()) {
      const account = this.byAddr.get(a.address.toBuffer());
      if (account) {
        return account;
      }
    }
    if (a.path != '') {
      if (a.path.indexOf(path.sep) === -1) {
        a.path = path.join(this.keydir, a.path);
      }
      for (const i of matches) {
        if (i.path === a.path) {
          return i;
        }
      }
      if (a.address.equals(Address.zero())) {
        return;
      }
    }
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
    if (!keybuffer) {
      return;
    }
    const keyjson = JSON.parse(keybuffer.toString());
    const addrstring = keyjson.address;
    const addr = Address.fromString('0x' + addrstring);
    const account: Accountinfo = { address: addr, path: path };
    return account;
  }
}
