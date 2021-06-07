import fs from 'fs';
import { Address } from 'ethereumjs-util';
import { createBufferFunctionalMap, hexStringToBuffer } from '@gxchain2/utils';
import { FileCache } from './filecache';

export type AccountInfo = {
  addrBuf: Buffer;
  path: string;
};

export class AccountCache {
  private keydir: string;
  private fileCache = new FileCache();
  private addrToPath = createBufferFunctionalMap<string>();

  constructor(keydir: string) {
    this.keydir = keydir;
  }

  accounts(): AccountInfo[] {
    this.scanAccounts();
    return Array.from(this.addrToPath.entries()).map(([addrBuf, path]) => {
      return {
        addrBuf,
        path
      };
    });
  }

  hasAddress(addr: Address): boolean {
    this.scanAccounts();
    return !!this.addrToPath.get(addr.toBuffer());
  }

  get(addrBuf: Buffer) {
    return this.addrToPath.get(addrBuf);
  }

  add(addrBuf: Buffer, path: string) {
    this.addrToPath.set(addrBuf, path);
  }

  private addByPath(path: string) {
    const keyjson = JSON.parse(fs.readFileSync(path).toString());
    return this.addrToPath.set(hexStringToBuffer(keyjson.address), path);
  }

  private deleteByPath(addrPath: string) {
    for (const [addrBuf, path] of this.addrToPath) {
      if (path === addrPath) {
        this.addrToPath.delete(addrBuf);
        return;
      }
    }
  }

  private scanAccounts() {
    const [creates, deletes, updates] = this.fileCache.scan(this.keydir);
    for (const fi of creates) {
      this.addByPath(fi);
    }
    for (const fi of deletes) {
      this.deleteByPath(fi);
    }
    for (const fi of updates) {
      this.deleteByPath(fi);
      this.addByPath(fi);
    }
  }
}
