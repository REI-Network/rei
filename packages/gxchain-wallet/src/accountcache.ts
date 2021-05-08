import { Address } from 'ethereumjs-util';
import { Accountinfo, urlcompare } from './accounts';
import fs from 'fs';
import path from 'path';
import { FunctionalMap, createBufferFunctionalMap } from '@gxchain2/utils';
import { FileCache } from './filecache';

class Errexpand extends Error {
  accountinfo = {};
}

export class AccountCache {
  keydir: string;
  //   watcher:watcher;
  byAddr: FunctionalMap<Buffer, Accountinfo[]> = createBufferFunctionalMap<Accountinfo[]>();
  all: Accountinfo[] = [];
  fileC: FileCache;
  constructor(keydir: string) {
    this.keydir = keydir;
    this.fileC = new FileCache();
  }

  accounts(): Accountinfo[] {
    this.scanAccounts();
    const cpy: Accountinfo[] = [];
    for (const account of this.all) {
      cpy.push(account);
    }
    return cpy;
  }

  hasAddress(addr: Address): boolean {
    this.scanAccounts();
    const instance = this.byAddr.get(addr.toBuffer());
    if (instance) {
      return instance.length > 0;
    }
    return false;
  }

  add(newaccount: Accountinfo) {
    let index = 0;
    for (let i = 0; i < this.all.length; i++) {
      if (urlcompare(this.all[i].url, newaccount.url)) {
        index = i;
        break;
      }
    }
    if (index < this.all.length && this.all[index] === newaccount) {
      return;
    }
    this.all = this.all.slice(0, index).concat(newaccount).concat(this.all.slice(index));
    let instance = this.byAddr.get(newaccount.address.toBuffer());
    if (instance) {
      instance.push(newaccount);
    } else {
      this.byAddr.set(newaccount.address.toBuffer(), [newaccount]);
    }
  }

  private removeAccount(slice: Accountinfo[], elem: Accountinfo): Accountinfo[] {
    for (const account of slice) {
      if (account === elem) {
        const index = slice.indexOf(account);
        slice = slice.slice(0, index).concat(slice.slice(index + 1));
        return slice;
      }
    }
    return slice;
  }

  delete(removed: Accountinfo) {
    this.all = this.removeAccount(this.all, removed);
    let instance = this.byAddr.get(removed.address.toBuffer());
    if (instance) {
      const ba = this.removeAccount(instance, removed);
      if (ba.length === 0) {
        this.byAddr.delete(removed.address.toBuffer());
      } else {
        instance = ba;
      }
    }
  }

  deleteByFile(path: string) {
    let index = 0;
    for (let i = 0; i < this.all.length; i++) {
      if (this.all[i].url.Path >= path) {
        index = i;
        break;
      }
    }

    if (index < this.all.length && this.all[index].url.Path === path) {
      const removed = this.all[index];
      this.all = this.all.slice(0, index).concat(this.all.slice(index + 1));
      let ba = this.removeAccount(this.byAddr.get(removed.address.toBuffer())!, removed);
      if (ba.length === 0) {
        this.byAddr.delete(removed.address.toBuffer());
      } else {
        let instance = this.byAddr.get(removed.address.toBuffer())!;
        instance = ba;
      }
    }
  }

  find(a: Accountinfo) {
    let matches = this.all;
    if (a.address != Address.zero()) {
      const accounts = this.byAddr.get(a.address.toBuffer());
      if (accounts) {
        matches = accounts;
      }
    }
    if (a.url.Path != '') {
      if (a.url.Path.indexOf(path.sep) === -1) {
        a.url.Path = path.join(this.keydir, a.url.Path);
      }
      for (const i of matches) {
        if (i.url === a.url) {
          return i;
        }
      }
      if (a.address === Address.zero()) {
        return;
      }
    }

    switch (matches.length) {
      case 1:
        return matches[0];
      case 0:
        return;
      default:
        const err = new Errexpand('The Address has more than one file exists');
        err.accountinfo = { Addr: a.address, match: matches };
        throw err;
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
      const a = this.readAccount(fi)!;
      this.add(a);
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
    const account: Accountinfo = { address: addr, url: { Path: path, Scheme: 'keystore' } };
    return account;
  }
}
