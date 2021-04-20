import { Address } from 'ethereumjs-util';
import { Accounts } from 'web3-eth-accounts';
import { Account, urlcompare } from './accounts';
import path from 'path';
import { FunctionalMap, createBufferFunctionalMap } from '@gxchain2/utils';
export class AccountCache {
  keydir: string;
  //   watcher:watcher;
  byAddr: FunctionalMap<Buffer, Account[]> = createBufferFunctionalMap<Account[]>();
  private all: Account[] = [];
  constructor(keydir: string) {
    this.keydir = keydir;
  }

  accounts(): Account[] {
    const cpy: Account[] = [];
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

  add(newaccount: Account) {
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

  private removeAccount(slice: Account[], elem: Account): Account[] {
    for (const account of slice) {
      if (account == elem) {
        const index = slice.indexOf(account);
        slice = slice.slice(0, index).concat(this.all.slice(index + 1));
        return slice;
      }
    }
    return slice;
  }

  delete(removed: Account) {
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

  find(a: Account) {
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
        return {};
      }
    }

    switch (matches.length) {
      case 1:
        return matches[0];
      case 0:
        return {};
      default:
        return {};
    }
  }
}
