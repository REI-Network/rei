import { Address } from 'ethereumjs-util';
import { Accounts } from 'web3-eth-accounts';
import { Accountinfo, urlcompare } from './accounts';
import path from 'path';
import { FunctionalMap, createBufferFunctionalMap } from '@gxchain2/utils';
export class AccountCache {
  keydir: string;
  //   watcher:watcher;
  byAddr: FunctionalMap<Buffer, Accountinfo[]> = createBufferFunctionalMap<Accountinfo[]>();
  private all: Accountinfo[] = [];
  constructor(keydir: string) {
    this.keydir = keydir;
  }

  accounts(): Accountinfo[] {
    const cpy: Accountinfo[] = [];
    for (const account of this.all) {
      cpy.push(account);
    }
    return cpy;
  }

  hasAddress(addr: Address): boolean {
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
    if (index < this.all.length && this.all[index] == newaccount) {
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
      if (account == elem) {
        const index = slice.indexOf(account);
        slice = slice.slice(0, index).concat(this.all.slice(index + 1));
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
      if (ba.length == 0) {
        this.byAddr.delete(removed.address.toBuffer());
      } else {
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
      if (a.url.Path.indexOf(path.sep) == -1) {
        a.url.Path = path.join(this.keydir, a.url.Path);
      }
      for (const i of matches) {
        if (i.url == a.url) {
          return i;
        }
      }
      if (a.address == Address.zero()) {
        return;
      }
    }

    switch (matches.length) {
      case 1:
        return matches[0];
      case 0:
        return;
      default:
        return;
    }
  }
}
