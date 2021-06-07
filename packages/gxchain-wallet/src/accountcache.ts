import fs from 'fs';
import { Address } from 'ethereumjs-util';
import { FunctionalMap, createBufferFunctionalMap } from '@gxchain2/utils';
import { Accountinfo } from './types';
import { FileCache } from './filecache';

export class AccountCache {
  private keydir: string;
  private byAddr: FunctionalMap<Buffer, Accountinfo> = createBufferFunctionalMap<Accountinfo>();
  private fileC: FileCache;
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

  get(buf: Buffer) {
    return this.byAddr.get(buf);
  }

  add(newaccount: Accountinfo) {
    this.byAddr.set(newaccount.address.toBuffer(), newaccount);
  }

  delete(removed: Accountinfo) {
    this.byAddr.delete(removed.address.toBuffer());
  }

  deleteByFile(path: string) {
    const ai = Array.from(this.byAddr.values()).find((addr) => addr.path === path);
    if (ai) {
      this.byAddr.delete(ai.address.toBuffer());
    }
  }

  find(a: Accountinfo) {
    return this.byAddr.get(a.address.toBuffer());
  }

  scanAccounts() {
    const [creates, deletes, updates] = this.fileC.scan(this.keydir);
    if (creates.length === 0 && deletes.length === 0 && updates.length === 0) {
      return;
    }

    for (const fi of creates) {
      this.add(this.readAccount(fi));
    }

    for (const fi of deletes) {
      this.deleteByFile(fi);
    }

    for (const fi of updates) {
      this.deleteByFile(fi);
      this.add(this.readAccount(fi));
    }
  }

  private readAccount(path: string) {
    const keyjson = JSON.parse(fs.readFileSync(path).toString());
    const address = Address.fromString('0x' + keyjson.address);
    const account: Accountinfo = { address, path };
    return account;
  }
}
